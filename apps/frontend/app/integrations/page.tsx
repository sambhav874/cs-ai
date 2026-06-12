'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Cloud, Database, FileSpreadsheet, Loader2, Plug, ShieldCheck, UploadCloud } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

interface SourceCatalogItem {
  source_type: string
  label: string
  family?: string
  auth_types?: string[]
  cadences?: string[]
  visibility?: string
  managed_by?: string
  runtime_status?: string
  config_location?: string
  description?: string
  profile_count?: number
  normalizes_to?: string[]
  credential_policy?: string
}

const familyIcon: Record<string, React.ReactNode> = {
  api: <Plug className="h-4 w-4" />,
  erp: <Database className="h-4 w-4" />,
  erp_crm: <Database className="h-4 w-4" />,
  crm: <Database className="h-4 w-4" />,
  itsm: <ShieldCheck className="h-4 w-4" />,
  warehouse: <Database className="h-4 w-4" />,
  database: <Database className="h-4 w-4" />,
  storage: <Cloud className="h-4 w-4" />,
  stream: <Plug className="h-4 w-4" />,
  message: <Plug className="h-4 w-4" />,
  file: <FileSpreadsheet className="h-4 w-4" />,
}

const titleCase = (value: string | undefined) => (
  (value || 'source')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
)

export default function IntegrationsPage() {
  const { isAuthenticated, authChecked, authenticatedFetch } = useAuth()
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL
  const [platformSources, setPlatformSources] = useState<SourceCatalogItem[]>([])
  const [uploadSources, setUploadSources] = useState<SourceCatalogItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authChecked) return
    if (!apiUrl) {
      setError('API URL is not configured.')
      setIsLoading(false)
      return
    }
    if (!isAuthenticated) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    async function loadCatalog() {
      setIsLoading(true)
      setError(null)
      try {
        const [platformResult, uploadResult] = await Promise.all([
          authenticatedFetch(`${apiUrl}/kpis/integrations/catalog`),
          authenticatedFetch(`${apiUrl}/kpis/source-catalog?scope=user`),
        ])
        if (cancelled) return
        if (platformResult.error) throw new Error(platformResult.error)
        if (uploadResult.error) throw new Error(uploadResult.error)
        setPlatformSources(Array.isArray(platformResult.data?.connectors) ? platformResult.data.connectors : [])
        setUploadSources(Array.isArray(uploadResult.data?.sources) ? uploadResult.data.sources : [])
      } catch (catalogError) {
        if (!cancelled) setError(catalogError instanceof Error ? catalogError.message : 'Unable to load integrations.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadCatalog()
    return () => {
      cancelled = true
    }
  }, [apiUrl, authChecked, isAuthenticated, authenticatedFetch])

  const groupedSources = useMemo(() => {
    const groups = new Map<string, SourceCatalogItem[]>()
    platformSources.forEach((source) => {
      const family = source.family || 'other'
      groups.set(family, [...(groups.get(family) || []), source])
    })
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right))
  }, [platformSources])

  return (
    <div className="min-h-screen bg-white pt-20 font-InterVar text-gray-900">
      <div className="border-b border-gray-200 px-4 py-5 md:px-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-serif text-3xl font-light text-gray-900">Integrations</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">
              Enterprise evidence sources are configured by ContractSense. Contract workspaces expose only upload and manual actual sources.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs md:min-w-[280px]">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="font-semibold text-gray-900">{platformSources.length}</p>
              <p className="text-gray-500">Platform connectors</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="font-semibold text-gray-900">{uploadSources.length}</p>
              <p className="text-gray-500">Workspace uploads</p>
            </div>
          </div>
        </div>
      </div>

      <main className="px-4 py-6 md:px-10">
        {isLoading ? (
          <div className="flex min-h-[280px] items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading integrations...
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : (
          <div className="space-y-6">
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-950">Platform-Managed Connectors</h2>
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
                  ContractSense side
                </span>
              </div>
              <div className="space-y-4">
                {groupedSources.map(([family, sources]) => (
                  <div key={family} className="rounded-md border border-gray-200 bg-white">
                    <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-700">
                        {familyIcon[family] || <Plug className="h-4 w-4" />}
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-950">{titleCase(family)}</h3>
                        <p className="text-xs text-gray-500">{sources.length} connector{sources.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                    <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-3">
                      {sources.map((source) => (
                        <article key={source.source_type} className="border-b border-r border-gray-100 p-4 last:border-b-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-semibold text-gray-950">{source.label}</h4>
                              <p className="mt-1 text-xs leading-5 text-gray-500">{source.description || 'Configured and secured by ContractSense.'}</p>
                            </div>
                            <span className="shrink-0 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                              {source.profile_count ? `${source.profile_count} profile${source.profile_count === 1 ? '' : 's'}` : 'Managed'}
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-500">
                            <span className="rounded bg-gray-50 px-2 py-1">Auth: {(source.auth_types || []).slice(0, 2).join(', ') || 'none'}</span>
                            <span className="rounded bg-gray-50 px-2 py-1">Cadence: {(source.cadences || []).slice(0, 2).join(', ') || 'manual'}</span>
                            <span className="rounded bg-gray-50 px-2 py-1">Secrets: {source.credential_policy || 'credential_ref_only'}</span>
                            <span className="rounded bg-gray-50 px-2 py-1">Runtime: {titleCase(source.runtime_status)}</span>
                          </div>
                          {source.normalizes_to?.length ? (
                            <p className="mt-2 truncate text-[11px] text-gray-400">
                              Normalizes to {source.normalizes_to.join(', ')}
                            </p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <UploadCloud className="h-4 w-4 text-gray-600" />
                <h2 className="text-sm font-semibold text-gray-950">Contract Workspace Sources</h2>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                {uploadSources.map((source) => (
                  <div key={source.source_type} className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-gray-900">{source.label}</p>
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">{titleCase(source.family)} · upload/manual</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
