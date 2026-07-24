import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const functionsRoot = join(root, 'supabase', 'functions')
const sourceRoot = join(root, 'src')
const failures = []

async function filesBelow(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesBelow(path, extension)
    return entry.isFile() && path.endsWith(extension) ? [path] : []
  }))
  return nested.flat()
}

const functionEntries = (await filesBelow(functionsRoot, 'index.ts'))
  .filter(file => !file.includes(`${join(functionsRoot, '_shared')}`))

for (const file of functionEntries) {
  const source = await readFile(file, 'utf8')
  const name = relative(functionsRoot, file)
  if (!name.startsWith(`send-email/`) && !source.includes('withErrorHandling')) {
    failures.push(`${name} does not use the shared response handler`)
  }
  if (/Access-Control-Allow-Origin[^\n]*['"]\*['"]/.test(source)) {
    failures.push(`${name} allows every CORS origin`)
  }
  if (/\bfrom['"]/.test(source)) {
    failures.push(`${name} uses import formatting that the remote function bundler cannot resolve`)
  }
}

const httpSource = await readFile(join(functionsRoot, '_shared', 'http.ts'), 'utf8')
for (const required of ['code', 'message', 'requestId', 'retryable', 'status', 'X-Request-ID', 'X-Response-Time-Ms']) {
  if (!httpSource.includes(required)) failures.push(`shared HTTP contract is missing ${required}`)
}

const sourceFiles = await filesBelow(sourceRoot, '.ts')
const tsxFiles = await filesBelow(sourceRoot, '.tsx')
for (const file of [...sourceFiles, ...tsxFiles]) {
  const source = await readFile(file, 'utf8')
  const name = relative(root, file)
  if (
    source.includes('supabase.functions.invoke(') &&
    !name.endsWith('src/lib/functionApi.ts') &&
    !name.endsWith('src/lib/outreachApi.ts')
  ) {
    failures.push(`${name} bypasses the shared Edge Function response parser`)
  }
}

if (failures.length) {
  console.error(`API response contract verification failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`Verified ${functionEntries.length} Edge Functions and all client-side invocation paths.`)
