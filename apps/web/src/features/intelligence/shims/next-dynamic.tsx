/** `next/dynamic` on React.lazy. Aliased in vite.config.ts and tsconfig.json. */
import * as React from 'react'

type Loader<P> = () => Promise<{ default: React.ComponentType<P> } | React.ComponentType<P>>

export default function dynamic<P extends object>(
  loader: Loader<P>,
  opts: { ssr?: boolean; loading?: () => React.ReactNode } = {},
): React.ComponentType<P> {
  const Lazy = React.lazy(async () => {
    const mod = await loader()
    return 'default' in mod ? mod : { default: mod }
  })
  const Loading = opts.loading
  return function Dynamic(props: P) {
    return (
      <React.Suspense fallback={Loading ? <Loading /> : null}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- P is generic; lazy() erases it */}
        <Lazy {...(props as any)} />
      </React.Suspense>
    )
  }
}
