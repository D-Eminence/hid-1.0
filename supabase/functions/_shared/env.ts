export function requireEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function optionalEnv(name: string, fallback = '') {
  return Deno.env.get(name) ?? fallback
}
