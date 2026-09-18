/**
 * ContractSense's API client, re-pointed at the platform login.
 *
 * Hand-written replacement for vendor/contractsense/.../lib/apiClient.ts —
 * same exports, so ported screens import it unchanged. Differences:
 *   - The base is `/intel/api/v1` (proxied to the intelligence service in dev
 *     by vite.config.ts, and by nginx in a deployment).
 *   - Auth is the lifecycle API's access token as a Bearer header, which
 *     FastAPI verifies (apps/intelligence/core/platform_identity.py). No
 *     cookie session, so no CSRF token either.
 *   - A 401 refreshes the token once through the SPA's auth store, then retries.
 */
import { useAuthStore } from '@/store/auth'

export const AUTH_SENTINEL = 'platform'
export const CSRF_COOKIE_NAME = 'contractsense_csrf'
export const INTEL_API = '/intel/api/v1'

export type ApiResult<T = unknown> = {
  data?: T
  error?: string
  response?: Response
}

export type UploadProgressEvent = {
  loaded: number
  total: number
  percent: number
}

export function apiBaseUrl() {
  return INTEL_API
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
}

export function isApiUrl(input: RequestInfo | URL) {
  const raw = urlOf(input)
  return raw.startsWith(INTEL_API) || raw.startsWith(`${window.location.origin}${INTEL_API}`)
}

/** Kept for import compatibility; the platform login has no CSRF cookie. */
export function csrfToken() {
  return ''
}

export function isUnsafeMethod(method?: string) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes((method || 'GET').toUpperCase())
}

export function authHeader(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function send(input: RequestInfo | URL, init: RequestInit, fetcher: typeof fetch) {
  const headers = new Headers(
    init.headers || (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined),
  )
  for (const [k, v] of Object.entries(authHeader())) headers.set(k, v)
  return fetcher(input, { ...init, headers })
}

/** Fetch with the platform token, refreshing it once on a 401. */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetcher: typeof fetch = window.fetch.bind(window),
) {
  const res = await send(input, init, fetcher)
  if (res.status !== 401 || !useAuthStore.getState().refreshToken) return res
  try {
    await useAuthStore.getState().refresh()
  } catch {
    return res
  }
  return send(input, init, fetcher)
}

export async function apiJson<T = unknown>(input: RequestInfo | URL, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await apiFetch(input, init)
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      return {
        response,
        error: errorBody?.detail || errorBody?.message || `Request failed with status ${response.status}`,
      }
    }
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return { response, data: null as T }
    }
    return { response, data: (await response.json()) as T }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown API error' }
  }
}

export async function apiDownload(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await apiFetch(input, init)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `Download failed with status ${response.status}`)
  }
  return response.blob()
}

export function apiUploadWithProgress<T = unknown>(
  url: string,
  body: FormData,
  options: { method?: 'POST' | 'PUT' | 'PATCH'; onProgress?: (event: UploadProgressEvent) => void } = {},
): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (event) => {
      const total = event.total || 0
      const percent = total > 0 ? Math.round((event.loaded / total) * 100) : 0
      options.onProgress?.({ loaded: event.loaded, total, percent })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({ data: JSON.parse(xhr.responseText || 'null') as T })
        } catch {
          resolve({ data: null as T })
        }
        return
      }
      try {
        const parsed = JSON.parse(xhr.responseText || '{}')
        resolve({ error: parsed.detail || parsed.message || `Upload failed with status ${xhr.status}` })
      } catch {
        resolve({ error: `Upload failed with status ${xhr.status}` })
      }
    }
    xhr.onerror = () => resolve({ error: 'Network error during upload' })
    xhr.onabort = () => resolve({ error: 'Upload aborted' })
    xhr.open(options.method || 'POST', url, true)
    for (const [k, v] of Object.entries(authHeader())) xhr.setRequestHeader(k, v)
    xhr.send(body)
  })
}
