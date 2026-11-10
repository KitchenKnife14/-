export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate || candidate.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(candidate)) return null

  try {
    const parsed = new URL(candidate)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
    if (parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}
