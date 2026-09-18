/**
 * ContractSense's URLs → the SPA's. ContractSense code keeps linking to its
 * own paths (`/dashboard/projects/…`); every link and router call goes through
 * here, so ported screens need no edits to navigate correctly.
 */
const RULES: Array<[RegExp, string]> = [
  [/^\/home\/?(?=$|[?#])/, '/dashboard'],
  [/^\/dashboard\/projects\//, '/projects/'],
  [/^\/dashboard\/?(?=$|[?#])/, '/projects'],
  [/^\/signin\/?(?=$|[?#])/, '/login'],
  [/^\/signup\/?(?=$|[?#])/, '/register'],
  [/^\/account\/?(?=$|[?#])/, '/profile'],
]

export function mapHref(href: string): string {
  if (!href.startsWith('/')) return href
  for (const [re, to] of RULES) {
    if (re.test(href)) return href.replace(re, to)
  }
  return href
}
