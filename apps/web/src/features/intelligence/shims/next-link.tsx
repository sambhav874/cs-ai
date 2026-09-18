/** `next/link` on react-router. Aliased in vite.config.ts and tsconfig.json. */
import * as React from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { mapHref } from './href'

type Href = string | { pathname?: string; query?: Record<string, string | number | undefined> }

export interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: Href
  prefetch?: boolean
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  legacyBehavior?: boolean
}

function toUrl(href: Href): string {
  if (typeof href === 'string') return href
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(href.query ?? {})) if (v !== undefined) qs.set(k, String(v))
  const q = qs.toString()
  return `${href.pathname ?? ''}${q ? `?${q}` : ''}`
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch: _p, replace, scroll: _s, shallow: _sh, passHref: _ph, legacyBehavior: _lb, ...rest },
  ref,
) {
  const url = mapHref(toUrl(href))
  if (/^(https?:|mailto:|tel:)/.test(url) || rest.target === '_blank') {
    return <a ref={ref} href={url} {...rest} />
  }
  return <RouterLink ref={ref} to={url} replace={replace} {...rest} />
})

export default Link
