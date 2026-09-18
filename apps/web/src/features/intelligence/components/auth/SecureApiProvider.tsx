/**
 * Hand-written replacement for ContractSense's SecureApiProvider. Ported
 * screens call `fetch` and axios directly against the intelligence API; this
 * attaches the platform token to exactly those requests (and nothing else).
 * Mounted once, by IntelligenceProviders.
 */
import { useEffect } from 'react'
import axios, { AxiosHeaders } from 'axios'
import { apiFetch, authHeader, isApiUrl, INTEL_API } from '@cs/lib/apiClient'

export default function SecureApiProvider() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
      isApiUrl(input) ? apiFetch(input, init, originalFetch) : originalFetch(input, init)

    const interceptor = axios.interceptors.request.use((config) => {
      const url = `${config.baseURL ?? ''}${config.url ?? ''}`
      if (!url.startsWith(INTEL_API)) return config
      const headers = AxiosHeaders.from(config.headers)
      for (const [k, v] of Object.entries(authHeader())) headers.set(k, v)
      config.headers = headers
      return config
    })

    return () => {
      window.fetch = originalFetch
      axios.interceptors.request.eject(interceptor)
    }
  }, [])
  return null
}
