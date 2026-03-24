import { buildProxiedUrl } from "@/proxy/url"

export async function proxyAwareFetch(input: {
  proxyUrl?: string
  requestInit: RequestInit
  targetUrl: string
}): Promise<Response> {
  const requestUrl =
    input.proxyUrl === undefined
      ? input.targetUrl
      : buildProxiedUrl(input.proxyUrl, input.targetUrl)

  return await fetch(requestUrl, input.requestInit)
}
