/** `next/navigation` on react-router. Aliased in vite.config.ts and tsconfig.json. */
import { useMemo } from 'react'
import {
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
} from 'react-router-dom'
import { mapHref } from './href'

export function useRouter() {
  const navigate = useNavigate()
  return useMemo(
    () => ({
      push: (href: string, _opts?: { scroll?: boolean }) => navigate(mapHref(href)),
      replace: (href: string, _opts?: { scroll?: boolean }) => navigate(mapHref(href), { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      refresh: () => window.location.reload(),
      prefetch: (_href: string) => undefined,
    }),
    [navigate],
  )
}

export function usePathname(): string {
  return useLocation().pathname
}

export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0]
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T {
  return useRouterParams() as unknown as T
}

/** Server-only in Next; in the SPA it can only be a client-side navigation. */
export function redirect(href: string): never {
  window.location.assign(mapHref(href))
  throw new Error(`redirect to ${href}`)
}

export function notFound(): never {
  throw new Error('Not found')
}
