/**
 * The context ContractSense screens expect, mounted once around them: the
 * selected account (the user's organisation), page breadcrumbs, and the fetch
 * interceptor that carries the platform token to the intelligence API.
 */
import type { ReactNode } from 'react'
import { AccountProvider } from '@cs/app/context/AccountContext'
import { BreadcrumbProvider } from '@cs/app/context/BreadcrumbContext'
import SecureApiProvider from '@cs/components/auth/SecureApiProvider'

export function IntelligenceProviders({ children }: { children: ReactNode }) {
  return (
    <AccountProvider>
      <BreadcrumbProvider>
        <SecureApiProvider />
        {children}
      </BreadcrumbProvider>
    </AccountProvider>
  )
}
