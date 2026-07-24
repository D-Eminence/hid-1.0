import { createAdminClient, requireRole } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString } from '../_shared/validation.ts'

const ALLOWED_PRODUCT_FIELDS = [
  'name',
  'description',
  'status',
  'available_standalone',
  'available_addon',
  'public_visible',
  'trial_eligible',
  'subscription_type',
  'default_billing_cycle',
  'setup_fee_minor',
  'currency',
  'display_order',
] as const

const ALLOWED_PRICE_FIELDS = [
  'product_id',
  'context',
  'visibility',
  'amount_minor',
  'currency',
  'billing_period',
  'unit',
  'active',
] as const

const SUBSCRIPTION_STATUSES = new Set([
  'trial',
  'active',
  'past_due',
  'grace_period',
  'restricted',
  'suspended',
  'cancelled',
  'expired',
])

function asRecord(value: unknown, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, `${field} must be an object.`)
  }
  return value as Record<string, unknown>
}

function pick(input: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(field => field in input).map(field => [field, input[field]]))
}

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  auth: Awaited<ReturnType<typeof requireRole>>,
  action: string,
  resourceType: string,
  resourceId: string | null,
  before: unknown,
  after: unknown,
) {
  const { error } = await admin.from('hid_audit_events').insert({
    actor_user_id: auth.user.id,
    actor_profile_id: auth.profile?.id ?? null,
    actor_role: auth.role,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    reason: 'Platform billing administration',
    metadata: { before, after },
  })
  if (error) throw new HttpError(400, error.message, error)
}

async function overview(admin: ReturnType<typeof createAdminClient>) {
  const [products, prices, plans, subscriptions, invoices, payments, organizations, settings] = await Promise.all([
    admin.from('hid_commercial_products').select('*').order('display_order'),
    admin.from('hid_commercial_prices').select('*'),
    admin.from('hid_subscription_plans').select('*').order('name'),
    admin
      .from('hid_organization_subscriptions')
      .select('*,organization:hid_organizations(id,name),plan:hid_subscription_plans(id,name)')
      .order('updated_at', { ascending: false }),
    admin.from('hid_platform_invoices').select('*').order('created_at', { ascending: false }).limit(100),
    admin.from('hid_platform_payments').select('*').order('created_at', { ascending: false }).limit(100),
    admin.from('hid_organizations').select('id,name').order('name'),
    admin.from('hid_platform_billing_settings').select('*').eq('id', true).single(),
  ])

  for (const result of [products, prices, plans, subscriptions, invoices, payments, organizations, settings]) {
    if (result.error) throw new HttpError(400, result.error.message, result.error)
  }

  const subscriptionRows = (subscriptions.data ?? []) as Array<Record<string, unknown>>
  const invoiceRows = (invoices.data ?? []) as Array<Record<string, unknown>>
  const activeSubscriptions = subscriptionRows.filter(subscription => subscription.status === 'active')
  const mrrMinor = activeSubscriptions.reduce((sum, subscription) => {
    const plan = subscription.plan && typeof subscription.plan === 'object'
      ? subscription.plan as Record<string, unknown>
      : null
    return sum + Number(subscription.override_price_minor ?? plan?.monthly_price_minor ?? 0)
  }, 0)
  const outstandingMinor = invoiceRows.reduce((sum, invoice) => sum + Number(invoice.balance_minor ?? 0), 0)

  return {
    products: products.data ?? [],
    prices: prices.data ?? [],
    plans: plans.data ?? [],
    subscriptions: subscriptionRows,
    invoices: invoiceRows,
    payments: payments.data ?? [],
    organizations: organizations.data ?? [],
    settings: settings.data,
    metrics: {
      mrr_minor: mrrMinor,
      arr_minor: mrrMinor * 12,
      active_subscriptions: activeSubscriptions.length,
      trials: subscriptionRows.filter(subscription => subscription.status === 'trial').length,
      past_due: subscriptionRows.filter(subscription => ['past_due', 'grace_period'].includes(`${subscription.status ?? ''}`)).length,
      suspended: subscriptionRows.filter(subscription => subscription.status === 'suspended').length,
      outstanding_minor: outstandingMinor,
    },
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  const auth = await requireRole(req, ['platform_admin'])
  const admin = createAdminClient()

  if (req.method === 'GET') {
    return json({ data: await overview(admin) })
  }
  if (req.method !== 'POST') {
    throw new HttpError(405, 'Method not allowed.')
  }

  const body = await readJson<Record<string, unknown>>(req)
  const action = asTrimmedString(body.action, 'action')

  if (action === 'save_product') {
    const product = asRecord(body.product, 'product')
    const productId = typeof body.product_id === 'string' && body.product_id.trim() ? body.product_id.trim() : null
    const changes = pick(product, ALLOWED_PRODUCT_FIELDS)
    let before: unknown = null
    let result

    if (productId) {
      const beforeResult = await admin.from('hid_commercial_products').select('*').eq('id', productId).maybeSingle()
      if (beforeResult.error) throw new HttpError(400, beforeResult.error.message, beforeResult.error)
      if (!beforeResult.data) throw new HttpError(404, 'That billing product could not be found.')
      before = beforeResult.data
      result = await admin
        .from('hid_commercial_products')
        .update({ ...changes, updated_at: new Date().toISOString(), updated_by: auth.user.id })
        .eq('id', productId)
        .select()
        .single()
    } else {
      const slug = asTrimmedString(product.slug, 'product.slug')
      result = await admin
        .from('hid_commercial_products')
        .insert({ ...changes, slug, updated_by: auth.user.id })
        .select()
        .single()
    }

    if (result.error) throw new HttpError(400, result.error.message, result.error)
    await audit(
      admin,
      auth,
      productId ? 'billing.product.updated' : 'billing.product.created',
      'commercial_product',
      result.data.id,
      before,
      result.data,
    )
    return json({ data: { product: result.data } })
  }

  if (action === 'save_price') {
    const price = asRecord(body.price, 'price')
    const payload = pick(price, ALLOWED_PRICE_FIELDS)
    const { data, error } = await admin
      .from('hid_commercial_prices')
      .upsert(payload, { onConflict: 'product_id,context' })
      .select()
      .single()
    if (error) throw new HttpError(400, error.message, error)
    await audit(admin, auth, 'billing.price.updated', 'commercial_price', data.id, null, data)
    return json({ data: { price: data } })
  }

  if (action === 'set_subscription_status') {
    const status = asTrimmedString(body.status, 'status')
    const subscriptionId = asTrimmedString(body.subscription_id, 'subscription_id')
    if (!SUBSCRIPTION_STATUSES.has(status)) {
      throw new HttpError(422, 'Invalid subscription status.')
    }

    const beforeResult = await admin
      .from('hid_organization_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .maybeSingle()
    if (beforeResult.error) throw new HttpError(400, beforeResult.error.message, beforeResult.error)
    if (!beforeResult.data) throw new HttpError(404, 'That organization subscription could not be found.')

    const { data, error } = await admin
      .from('hid_organization_subscriptions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', subscriptionId)
      .select()
      .single()
    if (error) throw new HttpError(400, error.message, error)
    await audit(
      admin,
      auth,
      'billing.subscription.status_changed',
      'organization_subscription',
      data.id,
      beforeResult.data,
      data,
    )
    return json({ data: { subscription: data } })
  }

  throw new HttpError(400, 'Unsupported billing action.')
}))
