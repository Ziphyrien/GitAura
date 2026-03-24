export function buildProxiedUrl(proxyBaseUrl: string, targetUrl: string): string {
  const base = proxyBaseUrl.replace(/\/+$/, "")
  return `${base}/?url=${encodeURIComponent(targetUrl)}`
}
