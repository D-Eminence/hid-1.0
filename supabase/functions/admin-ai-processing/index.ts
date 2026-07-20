import { createAdminClient, requireRole } from '../_shared/auth.ts'
import { decryptProviderApiKey, encryptProviderApiKey } from '../_shared/ai-provider-secrets.ts'
import { buildCacheHeaders, HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'

type AdminClient = any
type Json = Record<string, unknown>

const workloads = new Set([
  'ocr', 'handwriting_recognition', 'document_classification',
  'structured_data_extraction', 'clinical_entity_extraction',
  'document_summarization', 'patient_matching_assistance', 'image_understanding',
])

function required(value: unknown, field: string, max = 500) {
  const normalized = `${value ?? ''}`.trim()
  if (!normalized) throw new HttpError(400, `${field} is required.`)
  if (normalized.length > max) throw new HttpError(400, `${field} is too long.`)
  return normalized
}

function optional(value: unknown, max = 500) {
  const normalized = `${value ?? ''}`.trim()
  if (!normalized) return null
  if (normalized.length > max) throw new HttpError(400, 'A supplied value is too long.')
  return normalized
}

function integer(value: unknown, field: string, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max}.`)
  }
  return parsed
}

function money(value: unknown, field: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, `${field} must be a non-negative amount.`)
  }
  return Math.round(parsed)
}

function publicProvider(row: Json) {
  const {
    api_key_ciphertext: _ciphertext,
    api_key_iv: _iv,
    ...safe
  } = row
  return {
    ...safe,
    has_api_key: Boolean(row.api_key_ciphertext),
  }
}

async function audit(admin: AdminClient, auth: any, action: string, resourceType: string, resourceId: string | null, before: unknown, after: unknown) {
  const result = await admin.from('hid_audit_events').insert({
    actor_user_id: auth.user.id,
    actor_profile_id: auth.profile?.id ?? null,
    actor_role: auth.role,
    resource_type: resourceType,
    resource_id: resourceId,
    action,
    reason: 'Platform AI processing configuration changed',
    metadata: { before, after }, // Callers supply secret-free projections only.
  })
  if (result.error) throw new HttpError(400, result.error.message, result.error)
}

async function loadOverview(admin: AdminClient) {
  const now = new Date()
  const [providers, models, routes, budgets, usage, jobs, projects, folders, pages, ocrResults, imports, validations, lowClassifications, lowExtractions] = await Promise.all([
    admin.from('hid_ai_providers').select('*').order('priority').order('name'),
    admin.from('hid_ai_models').select('*,provider:hid_ai_providers(id,name,provider_type)').order('priority').order('display_name'),
    admin.from('hid_ai_workload_routes').select('*,primary_model:hid_ai_models!hid_ai_workload_routes_primary_model_id_fkey(id,display_name,model_id,provider:hid_ai_providers(id,name)),fallback_model:hid_ai_models!hid_ai_workload_routes_fallback_model_id_fkey(id,display_name,model_id,provider:hid_ai_providers(id,name))').order('workload'),
    admin.from('hid_ai_budgets').select('*,provider:hid_ai_providers(id,name),project:hid_migration_projects(id,name,project_reference)').eq('active', true),
    admin.rpc('hid_admin_ai_usage_rollup'),
    admin.from('hid_migration_jobs').select('id,status,job_type,provider,attempt_count,created_at,started_at,finished_at,migration_project_id').in('status', ['queued', 'leased', 'running', 'retry_scheduled', 'dead_letter']),
    admin.from('hid_migration_projects').select('id,name,project_reference,organization_id,status,organization:hid_organizations(name)'),
    admin.from('hid_migration_source_folders').select('id,migration_project_id'),
    admin.from('hid_migration_pages').select('id,migration_project_id'),
    admin.from('hid_migration_ocr_results').select('page_id,migration_project_id'),
    admin.from('hid_migration_import_items').select('id,migration_project_id,status,patient_id'),
    admin.from('hid_migration_validation_tasks').select('id,status').in('status', ['pending', 'claimed']),
    admin.from('hid_migration_classifications').select('*', { count: 'exact', head: true }).lt('confidence', 0.75),
    admin.from('hid_migration_extractions').select('*', { count: 'exact', head: true }).lt('overall_confidence', 0.75),
  ])
  for (const result of [providers, models, routes, budgets, usage, jobs, projects, folders, pages, ocrResults, imports, validations, lowClassifications, lowExtractions]) {
    if (result.error) throw new HttpError(400, result.error.message, result.error)
  }

  const emptyUsage = { requests: 0, successful_requests: 0, failed_requests: 0, rate_limited_requests: 0, timed_out_requests: 0, retries: 0, input_tokens: 0, output_tokens: 0, pages_processed: 0, estimated_cost_minor: 0, average_latency_ms: 0 }
  const usageRollup = (usage.data ?? {}) as Record<string, any>
  const todayUsage = { ...emptyUsage, ...(usageRollup.today ?? {}) }
  const monthly = { ...emptyUsage, ...(usageRollup.month ?? {}) }
  const projectUsage = new Map((usageRollup.by_project ?? []).map((row: any) => [row.migration_project_id, { ...emptyUsage, ...row }]))

  const activeJobs = jobs.data ?? []
  const queue = {
    queued: activeJobs.filter((job: any) => job.status === 'queued').length,
    processing: activeJobs.filter((job: any) => ['leased', 'running'].includes(job.status)).length,
    retrying: activeJobs.filter((job: any) => job.status === 'retry_scheduled').length,
    dead_letter: activeJobs.filter((job: any) => job.status === 'dead_letter').length,
    oldest_queued_at: activeJobs.filter((job: any) => ['queued', 'retry_scheduled'].includes(job.status)).sort((a: any, b: any) => `${a.created_at}`.localeCompare(`${b.created_at}`))[0]?.created_at ?? null,
  }
  const health = queue.dead_letter > 0 ? 'issues_detected' : queue.retrying > 0 ? 'degraded' : 'healthy'

  const projectRows = (projects.data ?? []).map((project: any) => {
    const projectPages = (pages.data ?? []).filter((page: any) => page.migration_project_id === project.id)
    const projectImports = (imports.data ?? []).filter((item: any) => item.migration_project_id === project.id)
    const projectJobs = activeJobs.filter((job: any) => job.migration_project_id === project.id)
    const stats: any = projectUsage.get(project.id) ?? emptyUsage
    const patients = new Set(projectImports.filter((item: any) => item.status === 'imported').map((item: any) => item.patient_id)).size
    return {
      id: project.id,
      name: project.name,
      project_reference: project.project_reference,
      organization_name: Array.isArray(project.organization) ? project.organization[0]?.name : project.organization?.name,
      pages_scanned: projectPages.length,
      folders_scanned: (folders.data ?? []).filter((folder: any) => folder.migration_project_id === project.id).length,
      patients_migrated: patients,
      failed_jobs: projectJobs.filter((job: any) => job.status === 'dead_letter').length,
      retrying_jobs: projectJobs.filter((job: any) => job.status === 'retry_scheduled').length,
      cost_per_page_minor: projectPages.length ? stats.estimated_cost_minor / projectPages.length : 0,
      cost_per_patient_minor: patients ? stats.estimated_cost_minor / patients : 0,
      ...stats,
    }
  })

  const platformBudget = (budgets.data ?? []).find((budget: any) => budget.scope_type === 'platform')
  return {
    providers: (providers.data ?? []).map((provider: Json) => publicProvider(provider)),
    models: models.data ?? [],
    routes: routes.data ?? [],
    budgets: budgets.data ?? [],
    usage: {
      today: todayUsage,
      month: monthly,
      by_provider: usageRollup.by_provider ?? [],
      today_by_provider: usageRollup.today_by_provider ?? [],
      by_workload: usageRollup.by_workload ?? [],
      projects: projectRows,
      quota_note: 'Provider quota is shown only when reported by that provider.',
    },
    processing: {
      health,
      ...queue,
      failures: {
        ocr: activeJobs.filter((job: any) => job.status === 'dead_letter' && job.job_type === 'ocr').length,
        classification: activeJobs.filter((job: any) => job.status === 'dead_letter' && job.job_type === 'classify').length,
        extraction: activeJobs.filter((job: any) => job.status === 'dead_letter' && job.job_type === 'extract').length,
        provider_errors: monthly.failed_requests,
        rate_limit_errors: monthly.rate_limited_requests,
        timeouts: monthly.timed_out_requests,
        low_confidence_results: Number(lowClassifications.count ?? 0) + Number(lowExtractions.count ?? 0),
        human_review: (validations.data ?? []).length,
      },
      failed_jobs: activeJobs.filter((job: any) => job.status === 'dead_letter').slice(0, 100),
    },
    migrate: {
      active_projects: (projects.data ?? []).filter((project: any) => project.status === 'active').length,
      patients_migrated: new Set((imports.data ?? []).filter((item: any) => item.status === 'imported').map((item: any) => item.patient_id)).size,
      folders_scanned: (folders.data ?? []).length,
      pages_processed: new Set((ocrResults.data ?? []).map((result: any) => result.page_id)).size,
      pending_validation: (validations.data ?? []).length,
      import_success_rate: (imports.data ?? []).length
        ? 100 * (imports.data ?? []).filter((item: any) => item.status === 'imported').length / (imports.data ?? []).length
        : 0,
      estimated_processing_cost_minor: monthly.estimated_cost_minor,
    },
    budget: platformBudget ? {
      monthly_budget_minor: platformBudget.monthly_budget_minor,
      spent_minor: monthly.estimated_cost_minor,
      remaining_minor: Math.max(0, Number(platformBudget.monthly_budget_minor) - monthly.estimated_cost_minor),
      warning_threshold_percent: platformBudget.warning_threshold_percent,
      critical_threshold_percent: platformBudget.critical_threshold_percent,
    } : null,
    checked_at: now.toISOString(),
  }
}

async function testConnection(admin: AdminClient, providerId: string) {
  const result = await admin.from('hid_ai_providers').select('*').eq('id', providerId).single()
  if (result.error || !result.data) throw new HttpError(404, 'Provider configuration was not found.')
  const provider = result.data as Json
  if (!provider.api_key_ciphertext) throw new HttpError(409, 'Add an API key before testing this provider.')
  const key = await decryptProviderApiKey(provider)
  const type = `${provider.provider_type}`
  let base = `${provider.api_base_url ?? ''}`.replace(/\/$/, '')
  if (!base) {
    base = type === 'anthropic' ? 'https://api.anthropic.com/v1'
      : type === 'google' ? 'https://generativelanguage.googleapis.com/v1beta'
      : type === 'deepseek' ? 'https://api.deepseek.com/v1'
      : type === 'openai' ? 'https://api.openai.com/v1'
      : ''
  }
  if (!base) throw new HttpError(400, 'Add an API base URL before testing this provider.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(provider.request_timeout_ms ?? 30000))
  const started = performance.now()
  try {
    const url = type === 'google' ? `${base}/models?key=${encodeURIComponent(key)}` : `${base}/models`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (type === 'anthropic') {
      headers['x-api-key'] = key
      headers['anthropic-version'] = `${provider.api_version ?? '2023-06-01'}`
    } else if (type !== 'google') {
      headers.Authorization = `Bearer ${key}`
    }
    const response = await fetch(url, { headers, signal: controller.signal })
    const latency = Math.round(performance.now() - started)
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'authentication_failed'
        : response.status === 404 ? 'model_not_available'
        : response.status === 429 ? 'rate_limited'
        : response.status >= 500 ? 'provider_unavailable'
        : 'connection_failed'
      await admin.from('hid_ai_providers').update({ last_failure_at: new Date().toISOString(), last_failure_code: code }).eq('id', providerId)
      throw new HttpError(response.status === 429 ? 429 : 409,
        code === 'authentication_failed' ? "We couldn't authenticate with this provider. Check the API key and try again."
          : code === 'rate_limited' ? 'The provider is rate limiting requests. Try again shortly.'
          : code === 'model_not_available' ? 'The configured provider endpoint or model is not available.'
          : 'The provider could not complete the connection test.')
    }
    const responsePayload = await response.json().catch(() => null) as Record<string, unknown> | null
    const listedModels = [
      ...(Array.isArray(responsePayload?.data) ? responsePayload.data : []),
      ...(Array.isArray(responsePayload?.models) ? responsePayload.models : []),
    ].map(value => {
      const row = value as Record<string, unknown>
      return `${row.id ?? row.name ?? ''}`.replace(/^models\//, '')
    }).filter(Boolean)
    const configuredModels = await admin.from('hid_ai_models').select('model_id,display_name').eq('provider_id', providerId).eq('status', 'active')
    if (configuredModels.error) throw new HttpError(400, configuredModels.error.message, configuredModels.error)
    if (listedModels.length && configuredModels.data?.length && !configuredModels.data.some((model: any) => listedModels.includes(model.model_id))) {
      await admin.from('hid_ai_providers').update({ last_failure_at: new Date().toISOString(), last_failure_code: 'model_not_available' }).eq('id', providerId)
      throw new HttpError(409, 'The provider connection works, but none of the configured HID models are available at this endpoint.')
    }
    await admin.from('hid_ai_providers').update({
      last_success_at: new Date().toISOString(),
      last_failure_code: null,
      average_latency_ms: latency,
    }).eq('id', providerId)
    const modelLabel = configuredModels.data?.length === 1 ? ` for ${configuredModels.data[0].display_name}` : ''
    return { status: 'connected', latency_ms: latency, message: `Connection successful. HID can access ${provider.name}${modelLabel}.` }
  } catch (error) {
    if (error instanceof HttpError) throw error
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'request_timed_out' : 'provider_unavailable'
    await admin.from('hid_ai_providers').update({ last_failure_at: new Date().toISOString(), last_failure_code: code }).eq('id', providerId)
    throw new HttpError(code === 'request_timed_out' ? 408 : 503,
      code === 'request_timed_out' ? 'The provider connection test timed out.' : 'The provider is currently unavailable.')
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  const auth = await requireRole(req, ['platform_admin'])
  const admin: AdminClient = createAdminClient()

  if (req.method === 'GET') {
    return json({ data: await loadOverview(admin) }, 200, buildCacheHeaders({ maxAgeSeconds: 2, staleWhileRevalidateSeconds: 8 }))
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Json>(req)
  const action = required(body.action, 'action', 80)
  const profileId = auth.profile?.id ?? null

  if (action === 'save_provider') {
    const providerId = optional(body.provider_id, 80)
    const beforeResult = providerId ? await admin.from('hid_ai_providers').select('*').eq('id', providerId).maybeSingle() : { data: null, error: null }
    if (beforeResult.error) throw new HttpError(400, beforeResult.error.message, beforeResult.error)
    const values: Json = {
      name: required(body.name, 'Provider name', 120),
      provider_type: required(body.provider_type, 'Provider type', 40),
      provider_kind: required(body.provider_kind, 'Provider kind', 30),
      api_base_url: optional(body.api_base_url),
      api_version: optional(body.api_version, 80),
      organization_reference: optional(body.organization_reference, 160),
      project_reference: optional(body.project_reference, 160),
      request_timeout_ms: integer(body.request_timeout_ms ?? 30000, 'Request timeout', 1000, 300000),
      max_retry_count: integer(body.max_retry_count ?? 3, 'Maximum retry count', 0, 20),
      status: required(body.status ?? 'active', 'Status', 30),
      priority: integer(body.priority ?? 100, 'Priority', 1, 10000),
      updated_by_user_profile_id: profileId,
      updated_at: new Date().toISOString(),
    }
    if (providerId && beforeResult.data?.status !== 'disabled' && values.status === 'disabled') {
      const activeJobs = await admin.from('hid_migration_jobs').select('payload').in('status', ['queued', 'leased', 'running', 'retry_scheduled'])
      if (activeJobs.error) throw new HttpError(400, activeJobs.error.message, activeJobs.error)
      const assignedJobs = (activeJobs.data ?? []).filter((job: any) => {
        const config = job.payload?.processing_configuration
        return config?.primary_provider_id === providerId || config?.fallback_provider_id === providerId
      }).length
      if (assignedJobs > 0 && body.confirm_disable !== true) {
        throw new HttpError(409, `${assignedJobs} active or queued jobs retain this provider configuration. Confirm disabling it only for new routing decisions.`)
      }
    }
    if (body.api_key) Object.assign(values, await encryptProviderApiKey(required(body.api_key, 'API key', 10000)))
    let saved
    if (providerId) {
      values.configuration_version = Number(beforeResult.data?.configuration_version ?? 1) + 1
      saved = await admin.from('hid_ai_providers').update(values).eq('id', providerId).select('*').single()
    } else {
      values.created_by_user_profile_id = profileId
      saved = await admin.from('hid_ai_providers').insert(values).select('*').single()
    }
    if (saved.error) throw new HttpError(400, saved.error.message, saved.error)
    await audit(admin, auth, providerId ? 'admin_ai_provider_updated' : 'admin_ai_provider_added', 'ai_provider', saved.data.id,
      beforeResult.data ? publicProvider(beforeResult.data) : null, publicProvider(saved.data))
    return json({ data: { provider: publicProvider(saved.data) } })
  }

  if (action === 'remove_provider_key') {
    const id = required(body.provider_id, 'provider_id', 80)
    const before = await admin.from('hid_ai_providers').select('*').eq('id', id).single()
    if (before.error) throw new HttpError(404, 'Provider configuration was not found.')
    const saved = await admin.from('hid_ai_providers').update({
      api_key_ciphertext: null, api_key_iv: null, api_key_masked: null,
      api_key_version: Number(before.data.api_key_version ?? 1) + 1,
      configuration_version: Number(before.data.configuration_version ?? 1) + 1,
      updated_by_user_profile_id: profileId, updated_at: new Date().toISOString(),
    }).eq('id', id).select('*').single()
    if (saved.error) throw new HttpError(400, saved.error.message, saved.error)
    await audit(admin, auth, 'admin_ai_provider_key_removed', 'ai_provider', id, publicProvider(before.data), publicProvider(saved.data))
    return json({ data: { provider: publicProvider(saved.data) } })
  }

  if (action === 'test_connection') {
    const providerId = required(body.provider_id, 'provider_id', 80)
    const result = await testConnection(admin, providerId)
    await audit(admin, auth, 'admin_ai_provider_tested', 'ai_provider', providerId, null, { status: result.status, latency_ms: result.latency_ms })
    return json({ data: result })
  }

  if (action === 'save_model') {
    const modelId = optional(body.model_config_id, 80)
    const before = modelId ? await admin.from('hid_ai_models').select('*').eq('id', modelId).maybeSingle() : { data: null, error: null }
    const purposes = Array.isArray(body.purposes) ? body.purposes.map(value => required(value, 'Purpose', 80)) : []
    if (purposes.some(value => !workloads.has(value))) throw new HttpError(400, 'One or more workload purposes are invalid.')
    const values = {
      provider_id: required(body.provider_id, 'provider_id', 80),
      display_name: required(body.display_name, 'Model name', 160),
      model_id: required(body.model_id, 'Model ID', 240),
      model_version: optional(body.model_version, 120),
      purposes,
      status: required(body.status ?? 'active', 'Status', 30),
      priority: integer(body.priority ?? 100, 'Priority', 1, 10000),
      input_cost_per_million_minor: body.input_cost_per_million_minor == null ? null : money(body.input_cost_per_million_minor, 'Input token cost'),
      output_cost_per_million_minor: body.output_cost_per_million_minor == null ? null : money(body.output_cost_per_million_minor, 'Output token cost'),
      page_cost_minor: body.page_cost_minor == null ? null : money(body.page_cost_minor, 'Page cost'),
      currency: required(body.currency ?? 'USD', 'Currency', 3).toUpperCase(),
      configuration_version: Number(before.data?.configuration_version ?? 0) + 1,
      updated_by_user_profile_id: profileId,
      updated_at: new Date().toISOString(),
      ...(!modelId ? { created_by_user_profile_id: profileId } : {}),
    }
    if (modelId && before.data?.status !== 'disabled' && values.status === 'disabled') {
      const activeJobs = await admin.from('hid_migration_jobs').select('payload').in('status', ['queued', 'leased', 'running', 'retry_scheduled'])
      if (activeJobs.error) throw new HttpError(400, activeJobs.error.message, activeJobs.error)
      const assignedJobs = (activeJobs.data ?? []).filter((job: any) => {
        const config = job.payload?.processing_configuration
        return config?.primary_model_id === modelId || config?.fallback_model_id === modelId
      }).length
      if (assignedJobs > 0 && body.confirm_disable !== true) {
        throw new HttpError(409, `${assignedJobs} active or queued jobs retain this model configuration. Confirm disabling it only for new routing decisions.`)
      }
    }
    const saved = modelId
      ? await admin.from('hid_ai_models').update(values).eq('id', modelId).select('*').single()
      : await admin.from('hid_ai_models').insert(values).select('*').single()
    if (saved.error) throw new HttpError(400, saved.error.message, saved.error)
    await audit(admin, auth, modelId ? 'admin_ai_model_updated' : 'admin_ai_model_added', 'ai_model', saved.data.id, before.data, saved.data)
    return json({ data: { model: saved.data } })
  }

  if (action === 'save_route') {
    const workload = required(body.workload, 'workload', 80)
    if (!workloads.has(workload)) throw new HttpError(400, 'Unsupported workload.')
    const before = await admin.from('hid_ai_workload_routes').select('*').eq('workload', workload).single()
    const queued = await admin.from('hid_migration_jobs').select('*', { count: 'exact', head: true }).eq('status', 'queued').eq('job_type', workload)
    const values = {
      processing_strategy: required(body.processing_strategy ?? 'ocr_then_ai', 'Processing strategy', 40),
      primary_model_id: optional(body.primary_model_id, 80),
      fallback_model_id: optional(body.fallback_model_id, 80),
      configuration_version: Number(before.data?.configuration_version ?? 0) + 1,
      updated_by_user_profile_id: profileId,
      updated_at: new Date().toISOString(),
    }
    const saved = await admin.from('hid_ai_workload_routes').update(values).eq('workload', workload).select('*').single()
    if (saved.error) throw new HttpError(400, saved.error.message, saved.error)
    await audit(admin, auth, 'admin_ai_workload_route_changed', 'ai_workload_route', workload, before.data, saved.data)
    return json({ data: { route: saved.data, queued_jobs_unchanged: queued.count ?? 0 } })
  }

  if (action === 'save_budget') {
    const scopeType = required(body.scope_type, 'Budget scope', 20)
    const values = {
      scope_type: scopeType,
      provider_id: scopeType === 'provider' ? required(body.provider_id, 'provider_id', 80) : null,
      migration_project_id: scopeType === 'project' ? required(body.migration_project_id, 'migration_project_id', 80) : null,
      monthly_budget_minor: money(body.monthly_budget_minor, 'Monthly budget'),
      currency: required(body.currency ?? 'USD', 'Currency', 3).toUpperCase(),
      warning_threshold_percent: Number(body.warning_threshold_percent ?? 80),
      critical_threshold_percent: Number(body.critical_threshold_percent ?? 95),
      block_non_critical: body.block_non_critical === true,
      active: true,
      updated_by_user_profile_id: profileId,
      updated_at: new Date().toISOString(),
    }
    if (values.warning_threshold_percent >= values.critical_threshold_percent) {
      throw new HttpError(400, 'The warning threshold must be below the critical threshold.')
    }
    let existingQuery = admin.from('hid_ai_budgets').select('id').eq('scope_type', scopeType)
    if (scopeType === 'provider') existingQuery = existingQuery.eq('provider_id', values.provider_id)
    if (scopeType === 'project') existingQuery = existingQuery.eq('migration_project_id', values.migration_project_id)
    const existing = await existingQuery.maybeSingle()
    if (existing.error) throw new HttpError(400, existing.error.message, existing.error)
    const saved = existing.data?.id
      ? await admin.from('hid_ai_budgets').update(values).eq('id', existing.data.id).select('*').single()
      : await admin.from('hid_ai_budgets').insert(values).select('*').single()
    if (saved.error) throw new HttpError(400, saved.error.message, saved.error)
    await audit(admin, auth, 'admin_ai_budget_updated', 'ai_budget', saved.data.id, null, saved.data)
    return json({ data: { budget: saved.data } })
  }

  if (action === 'retry_job') {
    const jobId = required(body.job_id, 'job_id', 80)
    const saved = await admin.from('hid_migration_jobs').update({
      status: 'retry_scheduled', available_at: new Date().toISOString(),
      last_error_code: null, last_error_message: null, updated_at: new Date().toISOString(),
    }).eq('id', jobId).eq('status', 'dead_letter').select('id,status,migration_project_id').single()
    if (saved.error) throw new HttpError(409, 'Only a dead-letter job can be retried.')
    await audit(admin, auth, 'admin_ai_job_manually_retried', 'migration_job', jobId, { status: 'dead_letter' }, { status: 'retry_scheduled' })
    return json({ data: { job: saved.data } })
  }

  throw new HttpError(400, 'That AI processing action is not supported.')
}))
