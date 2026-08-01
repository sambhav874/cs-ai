'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  Mail,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Upload,
  UploadCloud,
  Maximize2,
  Filter,
  Search,
  Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { useBreadcrumbs } from '@/app/context/BreadcrumbContext'
import KpiSourceFieldMapper from '@/components/kpis/KpiSourceFieldMapper'
import { apiUploadWithProgress } from '@/lib/apiClient'
import { detectKpiSourceFields, getDefaultKpiSourceMappings } from '@/lib/kpi-source-fields'
import type { KpiSourceFieldMapping } from '@/lib/kpi-source-fields'
import { motion } from 'framer-motion'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

const USER_KPI_SOURCE_TYPES = new Set(['csv', 'xlsx', 'json', 'xml', 'manual_attestation'])

type PanelKey = 'intelligence' | 'review' | 'sources' | 'flags' | 'logs'

interface FullContractData {
  _id: string
  contract_name: string
  status?: string
  projectId?: string | null
  project_id?: string | null
  project_name?: string | null
  project?: { _id?: string; name?: string | null } | null
}

interface ContractKPI {
  kpi_id: string
  contract_id: string
  document_id?: string | null
  chunk_id?: string | null
  contract_name?: string
  name: string
  description?: string
  kpi_type?: string
  party?: string | null
  responsible_party?: string | null
  operator?: string
  value?: string | number | null
  unit?: string | null
  value_min?: number | null
  value_max?: number | null
  consequence_value?: number | null
  consequence_unit?: string | null
  aggregation_type?: string | null
  trigger_condition?: string | null
  period_type?: string | null
  evaluation_window?: string | null
  source_config_id?: string | null
  source_config_status?: string | null
  field_mappings?: Array<Record<string, any>>
  evaluation_rule?: Record<string, any>
  remediation?: string | null
  remediation_sla?: string | null
  contact_email?: string | null
  quote?: string
  source_quote?: string
  clause_text?: string
  citation?: Record<string, any>
  citation_details?: Record<string, any>
  page_start?: number | null
  page_end?: number | null
  section?: string | null
  section_path?: string | null
  structural_path?: string | null
  confidence?: number
  confidence_reason?: string
  notes?: string | null
  needs_review?: boolean
  status?: string
  governance_status?: string | null
  governance_version?: number | null
  catalog_metric_key?: string | null
  certified_at?: string | null
  certified_by?: string | null
  business_hours?: Record<string, any>
  blackout_windows?: Array<Record<string, any>>
  severity_grace_periods?: Record<string, any>
  reporting_lock?: Record<string, any>
  missing_data_policy?: string | null
  error_budget?: Record<string, any>
  is_recommended?: boolean
  recommendation_reason?: string | null
  tracking_status?: string | null
  is_tracked?: boolean
  last_tracking_backfill?: {
    created_breach_count?: number
    skipped_count?: number
    actual_count?: number
  } | null
}

interface ContractKPISummary {
  total?: number
  by_type?: Record<string, number>
  by_status?: Record<string, number>
}

interface ContractKPIActual {
  actual_id: string
  kpi_id: string
  contract_id: string
  value?: string | number | null
  unit?: string | null
  source?: string | null
  metadata?: Record<string, any>
  timestamp?: string
  created_at?: string
  duplicate_skipped?: boolean
}

interface ContractKPIBreach {
  breach_id: string
  kpi_id: string
  contract_id: string
  actual_value?: string | number | null
  actual_unit?: string | null
  expected_value?: string | number | null
  operator?: string | null
  is_breach?: boolean
  status?: string
  severity?: string
  remediation?: string | null
  remediation_sla?: string | null
  breach_email_draft?: string | null
  breach_email_to?: string | null
  breach_email_recipient_source?: {
    source?: string
    confidence?: string
    matched_party?: string
  } | null
  penalty_amount?: number | null
  penalty_triggered?: string | null
  variance?: number | null
  variance_percent?: number | null
  burn_rate?: number | null
  period_locked?: boolean | null
  blackout_applied?: boolean | null
  deadline_at?: string | null
  sample_count?: number | null
  source?: string | null
  timestamp?: string
  source_kpi?: { name?: string; quote?: string; contract_name?: string }
  created_at?: string
}

interface KPIPortfolio {
  summary?: {
    contract_count?: number
    contracts_with_kpis?: number
    contracts_with_tracked_kpis?: number
    kpi_count?: number
    tracked_kpi_count?: number
    open_breach_count?: number
    source_count?: number
    stale_source_count?: number
    failed_source_count?: number
    actual_count?: number
    open_exposure?: number
    coverage_percent?: number
  }
  connector_health?: Record<string, number>
  risky_contracts?: Array<Record<string, any>>
  upcoming_reporting_windows?: Array<Record<string, any>>
  top_breaches?: ContractKPIBreach[]
}

interface KPICatalogEntry {
  metric_key: string
  display_name?: string
  description?: string
  certified_status?: string
  contract_family?: string
  unit?: string
  owner?: string
  owners?: string[]
  tags?: string[]
  kpi_count?: number
  tracked_count?: number
  certified_count?: number
  version?: number
  source_clause_lineage?: Array<Record<string, any>>
}

interface KPIAlert {
  alert_id: string
  alert_key?: string
  event_type?: string
  contract_id?: string
  kpi_id?: string
  breach_id?: string
  source_config_id?: string
  severity?: string
  status?: string
  title?: string
  message?: string
  channels?: string[]
  delivery?: Record<string, any>
  last_seen_at?: string
  created_at?: string
}

interface KPISourceCatalogItem {
  source_type: string
  label: string
  family?: string
  auth_types?: string[]
  cadences?: string[]
  enabled_for_contract_users?: boolean
}

interface KPISourceConfig {
  source_config_id: string
  contract_id: string
  project_id?: string | null
  display_name: string
  source_type: string
  connector_family?: string
  status?: string
  enabled?: boolean
  auth_type?: string
  schedule?: { cadence?: string; timezone?: string; start_at?: string | null }
  next_run_at?: string | null
  last_run_at?: string | null
  last_success_at?: string | null
  last_error?: string | null
  endpoint?: string | null
  signed_url?: string | null
  method?: string | null
  file_format?: string | null
  schema_fields?: Array<Record<string, any>>
  sample_payload?: any
  record_path?: string | null
  field_mappings?: Array<Record<string, any>>
  validation_rules?: Array<Record<string, any>>
  dedupe_key?: string | null
  watermark_field?: string | null
  watermark_value?: string | null
  kpi_ids?: string[]
  kpi_bindings?: KPISourceBinding[]
  last_fetch_status?: Record<string, any>
}

interface KPISourceBinding {
  binding_id?: string
  kpi_id: string
  enabled?: boolean
  match_rule?: Record<string, any> | null
  field_mappings?: Array<Record<string, any>>
  aggregation?: string | null
  unit_override?: string | null
  dedupe_key_override?: string | null
  watermark_field_override?: string | null
  validation_status?: string | Record<string, any> | null
}

interface KPISourceFetchRun {
  run_id: string
  contract_id?: string
  source_config_id: string
  source_type?: string
  status?: string
  trigger_type?: string
  started_at?: string
  finished_at?: string
  duration_ms?: number
  records_fetched?: number
  records_accepted?: number
  records_skipped?: number
  created_actual_count?: number
  created_breach_count?: number
  deferred_evaluation_count?: number
  normalized_preview?: Array<Record<string, any>>
  skipped_rows?: Array<Record<string, any>>
  errors?: string[]
  watermark_before?: any
  watermark_after?: any
}

interface KPISourceRunDetail {
  fetch_run: KPISourceFetchRun
  created_actuals: ContractKPIActual[]
  created_breaches: ContractKPIBreach[]
  normalized_rows?: Array<Record<string, any>>
  skipped_rows?: Array<Record<string, any>>
}

const titleCase = (value?: string | null) => (
  value
    ? value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Not specified'
)

const isKpiTracked = (kpi?: ContractKPI | null) => {
  const status = String(kpi?.tracking_status || '').toLowerCase()
  return Boolean(kpi?.is_tracked || status === 'tracked' || status === 'active')
}

const isKpiRecommended = (kpi?: ContractKPI | null) => {
  const status = String(kpi?.tracking_status || '').toLowerCase()
  return Boolean(kpi?.is_recommended || status === 'recommended')
}

const toNumber = (value?: string | number | null) => {
  if (value == null || value === '') return null
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(Math.max(0, value))

const formatKpiValue = (kpi: ContractKPI) => {
  const pieces: string[] = []
  if (kpi.operator && kpi.operator !== '=') pieces.push(kpi.operator)
  if (kpi.value_min != null || kpi.value_max != null) {
    pieces.push(`${kpi.value_min ?? '?'}${kpi.value_max != null ? ` - ${kpi.value_max}` : ''}`)
  } else if (kpi.value != null && kpi.value !== '') {
    pieces.push(String(kpi.value))
  }
  if (kpi.unit) pieces.push(kpi.unit)
  return pieces.length ? pieces.join(' ') : 'Not specified'
}

const formatConsequence = (kpi: ContractKPI) => {
  const pieces: string[] = []
  if (kpi.consequence_value != null) pieces.push(String(kpi.consequence_value))
  if (kpi.consequence_unit) pieces.push(kpi.consequence_unit)
  if (kpi.aggregation_type) pieces.push(`(${titleCase(kpi.aggregation_type)})`)
  return pieces.length ? pieces.join(' ') : 'Not specified'
}

const severityFor = (breach: ContractKPIBreach, kpi?: ContractKPI) => {
  if (!breach.is_breach) return 'OK'
  if (breach.severity) return titleCase(breach.severity)
  const exposure = Math.abs(toNumber(kpi?.consequence_value) || 0)
  if (exposure >= 50000) return 'Critical'
  if (exposure >= 10000) return 'High'
  if (exposure > 0) return 'Medium'
  return 'Low'
}

const statusTone = (value?: string | null) => {
  const status = String(value || '').toLowerCase()
  if (['approved', 'tracked', 'ready', 'mapped', 'enabled', 'clear', 'ok', 'completed'].includes(status)) {
    return 'border-gray-300 bg-white text-gray-800'
  }
  if (['open', 'failed', 'last_fetch_failed', 'critical', 'high'].some((item) => status.includes(item))) {
    return 'border-gray-400 bg-white text-gray-950'
  }
  if (['review', 'recommended', 'draft', 'pending', 'medium'].some((item) => status.includes(item))) {
    return 'border-gray-200 bg-gray-50 text-gray-700'
  }
  return 'border-gray-200 bg-gray-50 text-gray-600'
}

const kpiCode = (kpi: ContractKPI, index: number) => {
  return String(index + 1)
}

const sourceBindingId = (sourceConfigId: string, kpiId: string, index: number) => {
  const seed = `${sourceConfigId}:${kpiId}:${index}`
  let hash = 0
  for (let offset = 0; offset < seed.length; offset += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(offset)) | 0
  }
  return `bind_${Math.abs(hash).toString(16)}`
}

const normalizeFieldMappings = (fieldMappings?: Array<Record<string, any>>): KpiSourceFieldMapping[] => (
  (fieldMappings || [])
    .filter((mapping) => mapping && typeof mapping === 'object')
    .map((mapping) => ({ ...mapping }))
)

const mappingForField = (fieldMappings: Array<Record<string, any>> | undefined, kpiField: string) => (
  (fieldMappings || []).find((mapping) => String(mapping.kpi_field || mapping.target_field || mapping.target || mapping.field || '') === kpiField)
)

const sourceFieldFor = (fieldMappings: Array<Record<string, any>> | undefined, kpiField: string) => (
  String(mappingForField(fieldMappings, kpiField)?.source_field || mappingForField(fieldMappings, kpiField)?.source || '')
)

const setFieldMapping = (
  fieldMappings: Array<Record<string, any>> | undefined,
  kpiField: string,
  sourceField: string,
  transform = 'string',
) => {
  const mappings = normalizeFieldMappings(fieldMappings)
  const index = mappings.findIndex((mapping) => String(mapping.kpi_field || mapping.target_field || mapping.target || mapping.field || '') === kpiField)
  const normalizedSourceField = sourceField.trim()
  if (!normalizedSourceField) {
    if (index >= 0) mappings.splice(index, 1)
    return mappings
  }
  const next = { kpi_field: kpiField, source_field: normalizedSourceField, transform }
  if (index >= 0) mappings[index] = { ...mappings[index], ...next }
  else mappings.push(next)
  return mappings
}

const bindingsForSource = (config: KPISourceConfig, kpis: ContractKPI[]) => {
  const explicitBindings = Array.isArray(config.kpi_bindings) && config.kpi_bindings.length > 0
  const bindingByKpiId = new Map<string, KPISourceBinding>()
  ;(config.kpi_bindings || []).forEach((binding) => {
    if (binding?.kpi_id) bindingByKpiId.set(String(binding.kpi_id), binding)
  })
  const legacyKpiIds = new Set((config.kpi_ids || []).map(String))
  return kpis.map((kpi, index) => {
    const existing = bindingByKpiId.get(kpi.kpi_id)
    return {
      binding_id: existing?.binding_id || sourceBindingId(config.source_config_id, kpi.kpi_id, index + 1),
      kpi_id: kpi.kpi_id,
      enabled: existing ? existing.enabled !== false : !explicitBindings && legacyKpiIds.has(kpi.kpi_id),
      match_rule: existing?.match_rule || {},
      field_mappings: normalizeFieldMappings(existing?.field_mappings),
      aggregation: existing?.aggregation || kpi.aggregation_type || 'latest',
      unit_override: existing?.unit_override || null,
      dedupe_key_override: existing?.dedupe_key_override || null,
      watermark_field_override: existing?.watermark_field_override || null,
      validation_status: existing?.validation_status || null,
    } satisfies KPISourceBinding
  })
}

const enabledKpiIdsForSource = (config: KPISourceConfig, kpis?: ContractKPI[]) => {
  const bindings = kpis ? bindingsForSource(config, kpis) : (config.kpi_bindings || [])
  const ids = bindings.filter((binding) => binding.enabled !== false).map((binding) => String(binding.kpi_id))
  if (ids.length || (config.kpi_bindings || []).length) return Array.from(new Set(ids))
  return Array.from(new Set((config.kpi_ids || []).map(String).filter(Boolean)))
}

const upsertSourceBinding = (
  config: KPISourceConfig,
  kpis: ContractKPI[],
  nextBinding: KPISourceBinding,
) => bindingsForSource(config, kpis).map((binding) => (
  binding.kpi_id === nextBinding.kpi_id ? { ...binding, ...nextBinding } : binding
))

const bindingEffectiveMappings = (config: KPISourceConfig, binding?: KPISourceBinding | null) => (
  binding?.field_mappings?.length ? binding.field_mappings : config.field_mappings || []
)

const bindingStatus = (config: KPISourceConfig, binding: KPISourceBinding, enabledCount: number) => {
  if (binding.enabled === false) return 'disabled'
  const mappings = bindingEffectiveMappings(config, binding)
  const hasValue = Boolean(sourceFieldFor(mappings, 'actual_value') || sourceFieldFor(mappings, 'value'))
  if (!hasValue) return 'missing_value_field'
  if (!sourceFieldFor(mappings, 'timestamp')) return 'missing_timestamp'
  if (enabledCount > 1 && !Object.keys(binding.match_rule || {}).length && !binding.field_mappings?.length) return 'no_match_rule'
  return 'valid'
}

const bindingStatusLabel = (status: string) => {
  if (status === 'missing_value_field') return 'Missing value'
  if (status === 'missing_timestamp') return 'Missing timestamp'
  if (status === 'no_match_rule') return 'Needs rule'
  return titleCase(status)
}

const quoteFor = (kpi: ContractKPI) => (
  kpi.citation?.quote || kpi.citation_details?.quote || kpi.source_quote || kpi.quote || kpi.clause_text || ''
)

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Not stamped'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const actualLabel = (actual?: ContractKPIActual | null, kpi?: ContractKPI | null) => {
  if (!actual) return 'No actual'
  return `${actual.value ?? 'N/A'} ${actual.unit || kpi?.unit || ''}`.trim()
}

const actualTimestamp = (actual?: ContractKPIActual | null) => actual?.timestamp || actual?.created_at || null

const expectedFor = (breach: ContractKPIBreach, kpi?: ContractKPI | null) => (
  `${breach.operator || kpi?.operator || ''} ${breach.expected_value ?? kpi?.value_min ?? kpi?.value ?? 'N/A'} ${kpi?.unit || breach.actual_unit || ''}`.trim()
)

const breachNarrative = (breach: ContractKPIBreach, kpi?: ContractKPI | null) => {
  const actual = `${breach.actual_value ?? 'N/A'} ${breach.actual_unit || kpi?.unit || ''}`.trim()
  const expected = expectedFor(breach, kpi)
  if (!breach.is_breach) return `Actual value ${actual} meets the contract threshold (${expected}).`

  const operator = String(breach.operator || kpi?.operator || '').trim()
  const actualNumber = toNumber(breach.actual_value)
  const expectedNumber = toNumber(breach.expected_value ?? kpi?.value_min ?? kpi?.value)
  if (actualNumber != null && expectedNumber != null) {
    if ((operator.includes('>') || operator === 'min') && actualNumber < expectedNumber) {
      return `Actual value ${actual} fell below the contractual threshold (${expected}).`
    }
    if ((operator.includes('<') || operator === 'max') && actualNumber > expectedNumber) {
      return `Actual value ${actual} exceeded the contractual threshold (${expected}).`
    }
  }
  return `Actual value ${actual} violated the contractual threshold (${expected}).`
}

const buildEscalationDraft = (breach: ContractKPIBreach, kpi?: ContractKPI) => {
  const expected = expectedFor(breach, kpi)
  const actual = `${breach.actual_value ?? 'not reported'} ${breach.actual_unit || kpi?.unit || ''}`.trim()
  return [
    `Breach alert for ${kpi?.name || breach.source_kpi?.name || breach.kpi_id}`,
    '',
    `Expected: ${expected}`,
    `Actual: ${actual}`,
    `Status: ${breach.status || (breach.is_breach ? 'open' : 'clear')}`,
    `Remediation: ${breach.remediation || kpi?.remediation || 'Please provide corrective action and owner update.'}`,
  ].join('\n')
}

const chartPointsFor = (actuals: ContractKPIActual[]) => {
  const ordered = [...actuals].sort((left, right) => (
    new Date(actualTimestamp(left) || 0).getTime() - new Date(actualTimestamp(right) || 0).getTime()
  ))
  return ordered.map((actual, index) => ({
    xLabel: actualTimestamp(actual) ? new Date(actualTimestamp(actual) as string).toLocaleDateString() : `#${index + 1}`,
    value: toNumber(actual.value) ?? 0,
  }))
}

type IngestionMode = 'manual' | 'scheduled' | 'realtime' | 'attestation'

const ingestionModeFor = (source?: KPISourceConfig | null): IngestionMode => {
  if (!source) return 'manual'
  if (source.source_type === 'manual_attestation') return 'attestation'
  const cadence = String(source.schedule?.cadence || '').toLowerCase()
  if (['webhook', 'real_time', 'realtime', 'on_file_arrival'].includes(cadence)) return 'realtime'
  if (source.enabled || !['', 'manual'].includes(cadence)) return 'scheduled'
  return 'manual'
}

const ingestionModeLabel = (source?: KPISourceConfig | null) => {
  const mode = ingestionModeFor(source)
  if (mode === 'scheduled') return `Scheduled ${titleCase(source?.schedule?.cadence || 'polling')}`
  if (mode === 'realtime') return 'Webhook / realtime'
  if (mode === 'attestation') return 'Manual attestation'
  return 'Manual fetch'
}

const runDisplayTime = (run: KPISourceFetchRun) => formatDateTime(run.finished_at || run.started_at)

const runDuration = (run: KPISourceFetchRun) => {
  if (run.duration_ms != null) {
    if (run.duration_ms < 1000) return `${run.duration_ms}ms`
    return `${(run.duration_ms / 1000).toFixed(1)}s`
  }
  if (run.started_at && run.finished_at) {
    const delta = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
    if (Number.isFinite(delta) && delta >= 0) return `${(delta / 1000).toFixed(1)}s`
  }
  return 'running'
}

const sourceEndpointLabel = (source?: KPISourceConfig | null) => {
  if (!source) return 'Actual ingestion'
  if (source.endpoint) return `${source.method || 'GET'} ${source.endpoint}`
  if (source.signed_url) return 'Signed file URL'
  if (source.source_type === 'manual_attestation') return 'Workspace attestation'
  if (['csv', 'xlsx', 'json', 'xml'].includes(source.source_type)) return `${titleCase(source.source_type)} upload sample`
  return titleCase(source.source_type)
}

export default function ContractKpiManagementPage() {
  const { setBreadcrumbs } = useBreadcrumbs()
  const router = useRouter()
  const params = useParams()
  const contractId = typeof params?.contract_id === 'string' ? params.contract_id : ''
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL
  const { token, authChecked, isAuthenticated, authenticatedFetch } = useAuth()

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [activePanel, setActivePanel] = useState<PanelKey>('review')
  const [contract, setContract] = useState<FullContractData | null>(null)
  const [kpis, setKpis] = useState<ContractKPI[]>([])
  const [summary, setSummary] = useState<ContractKPISummary | null>(null)
  const [actuals, setActuals] = useState<ContractKPIActual[]>([])
  const [breaches, setBreaches] = useState<ContractKPIBreach[]>([])
  const [portfolio, setPortfolio] = useState<KPIPortfolio | null>(null)
  const [catalogEntries, setCatalogEntries] = useState<KPICatalogEntry[]>([])
  const [kpiAlerts, setKpiAlerts] = useState<KPIAlert[]>([])
  const [sourceCatalog, setSourceCatalog] = useState<KPISourceCatalogItem[]>([])
  const [sourceConfigs, setSourceConfigs] = useState<KPISourceConfig[]>([])
  const [sourceRuns, setSourceRuns] = useState<Record<string, KPISourceFetchRun[]>>({})
  const [runDetails, setRunDetails] = useState<Record<string, KPISourceRunDetail | { error: string }>>({})
  const [sourceResults, setSourceResults] = useState<Record<string, any>>({})
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [samplePayload, setSamplePayload] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSavingSource, setIsSavingSource] = useState(false)
  const [isRunningSource, setIsRunningSource] = useState(false)
  const [isCreatingAlertRules, setIsCreatingAlertRules] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sortedKpis = useMemo(() => (
    [...kpis].sort((left, right) => (
      Number(isKpiTracked(right)) - Number(isKpiTracked(left)) ||
      (left.page_start || 9999) - (right.page_start || 9999) ||
      (left.kpi_type || '').localeCompare(right.kpi_type || '') ||
      left.name.localeCompare(right.name)
    ))
  ), [kpis])
  const kpiById = useMemo(() => new Map(kpis.map((kpi) => [kpi.kpi_id, kpi])), [kpis])
  const trackedKpis = useMemo(() => sortedKpis.filter(isKpiTracked), [sortedKpis])
  const activeBreaches = useMemo(() => (
    breaches.filter((breach) => isKpiTracked(kpiById.get(breach.kpi_id)) && breach.is_breach && breach.status !== 'resolved')
  ), [breaches, kpiById])
  const visibleBreaches = useMemo(() => (
    breaches.filter((breach) => isKpiTracked(kpiById.get(breach.kpi_id)))
  ), [breaches, kpiById])
  const deferredCount = sortedKpis.filter((kpi) => kpi.status !== 'ignored' && !isKpiTracked(kpi)).length
  const recommendedTrackCount = sortedKpis.filter((kpi) => isKpiRecommended(kpi) && !isKpiTracked(kpi) && kpi.status !== 'ignored').length
  const exposure = activeBreaches.reduce((total, breach) => total + Math.abs(toNumber(kpiById.get(breach.kpi_id)?.consequence_value) || 0), 0)
  const openAlertCount = kpiAlerts.filter((alert) => String(alert.status || 'open').toLowerCase() === 'open').length
  const certifiedMetricCount = catalogEntries.filter((entry) => String(entry.certified_status || '').toLowerCase() === 'certified').length
  const complianceRate = trackedKpis.length
    ? Math.max(0, Math.round(((trackedKpis.length - activeBreaches.length) / trackedKpis.length) * 100))
    : 0
  const userSourceCatalog = useMemo(() => (
    sourceCatalog.filter((source) => source.enabled_for_contract_users !== false && USER_KPI_SOURCE_TYPES.has(source.source_type))
  ), [sourceCatalog])
  const userSourceConfigs = useMemo(() => (
    sourceConfigs.filter((config) => USER_KPI_SOURCE_TYPES.has(config.source_type))
  ), [sourceConfigs])
  const sourcesByKpiId = useMemo(() => {
    const grouped = new Map<string, KPISourceConfig[]>()
    const add = (kpiId: string | undefined | null, source: KPISourceConfig) => {
      if (!kpiId) return
      const current = grouped.get(kpiId) || []
      if (!current.some((item) => item.source_config_id === source.source_config_id)) {
        current.push(source)
        grouped.set(kpiId, current)
      }
    }
    userSourceConfigs.forEach((config) => {
      enabledKpiIdsForSource(config, kpis).forEach((kpiId) => add(kpiId, config))
    })
    kpis.forEach((kpi) => {
      const legacy = userSourceConfigs.find((config) => config.source_config_id === kpi.source_config_id)
      if (legacy) add(kpi.kpi_id, legacy)
    })
    return grouped
  }, [kpis, userSourceConfigs])
  const selectedSource = useMemo(() => (
    userSourceConfigs.find((config) => config.source_config_id === selectedSourceId) || userSourceConfigs[0] || null
  ), [userSourceConfigs, selectedSourceId])
  const allFetchRuns = useMemo(() => (
    userSourceConfigs
      .flatMap((config) => (sourceRuns[config.source_config_id] || []).map((run) => ({ ...run, source_config_id: run.source_config_id || config.source_config_id })))
      .sort((left, right) => new Date(right.started_at || right.finished_at || 0).getTime() - new Date(left.started_at || left.finished_at || 0).getTime())
  ), [sourceRuns, userSourceConfigs])
  const actualsByKpiId = useMemo(() => {
    const grouped = new Map<string, ContractKPIActual[]>()
    actuals.forEach((actual) => {
      const list = grouped.get(actual.kpi_id) || []
      list.push(actual)
      grouped.set(actual.kpi_id, list)
    })
    return grouped
  }, [actuals])

  useEffect(() => {
    if (!selectedSource) {
      setSamplePayload('')
      return
    }
    setSamplePayload(
      selectedSource.sample_payload == null
        ? ''
        : typeof selectedSource.sample_payload === 'string'
          ? selectedSource.sample_payload
          : JSON.stringify(selectedSource.sample_payload, null, 2)
    )
  }, [selectedSource?.source_config_id])

  useEffect(() => {
    if (!selectedSourceId && sourceConfigs[0]?.source_config_id) {
      setSelectedSourceId(sourceConfigs[0].source_config_id)
    }
  }, [sourceConfigs, selectedSourceId])

  useEffect(() => {
    if (contract) {
      setBreadcrumbs([
        { label: "Projects", href: "/dashboard?view=all" },
        { label: contract.project?.name || "Contract", href: `/dashboard?project=${contract.project_id || contract.projectId || contract.project?._id || ''}` },
        { label: contract.contract_name || "Contract", href: `/contracts/${contractId}` },
        { label: "KPI Management", href: `/contracts/${contractId}/kpis` }
      ]);
    } else {
      setBreadcrumbs([
        { label: "Projects", href: "/dashboard?view=all" },
        { label: "KPI Management", href: `/contracts/${contractId}/kpis` }
      ]);
    }
  }, [contract, contractId, setBreadcrumbs]);

  const loadFetchRuns = useCallback(async (config: KPISourceConfig) => {
    if (!apiUrl || !config?.source_config_id) return
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}/fetch-runs`)
    if (!result.error) {
      setSourceRuns((current) => ({
        ...current,
        [config.source_config_id]: Array.isArray(result.data?.fetch_runs) ? result.data.fetch_runs : [],
      }))
    }
  }, [apiUrl, authenticatedFetch, contractId])

  const loadRunDetail = useCallback(async (sourceConfigId: string, runId: string) => {
    if (!apiUrl || !sourceConfigId || !runId || runDetails[runId]) return
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(sourceConfigId)}/fetch-runs/${encodeURIComponent(runId)}`)
    setRunDetails((current) => ({
      ...current,
      [runId]: result.error ? { error: result.error } : result.data,
    }))
  }, [apiUrl, authenticatedFetch, contractId, runDetails])

  const loadWorkspace = useCallback(async () => {
    if (!apiUrl || !contractId || !authChecked || !isAuthenticated) return
    setIsLoading(true)
    setError(null)
    try {
      const [contractResult, kpiResult, actualResult, breachResult, catalogResult, sourceResult] = await Promise.all([
        authenticatedFetch(`${apiUrl}/contracts/${contractId}`),
        authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis`),
        authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/actuals`),
        authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/breaches`),
        authenticatedFetch(`${apiUrl}/kpis/source-catalog?scope=user`),
        authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs`),
      ])
      const firstError = [contractResult, kpiResult, actualResult, breachResult, catalogResult, sourceResult].find((result) => result.error)
      if (firstError?.error) throw new Error(firstError.error)
      const loadedContract = contractResult.data || null
      setContract(loadedContract)
      setKpis(Array.isArray(kpiResult.data?.kpis) ? kpiResult.data.kpis : [])
      setSummary(kpiResult.data?.summary || null)
      setActuals(Array.isArray(actualResult.data?.actuals) ? actualResult.data.actuals : [])
      setBreaches(Array.isArray(breachResult.data?.breaches) ? breachResult.data.breaches : [])
      setSourceCatalog(Array.isArray(catalogResult.data?.sources) ? catalogResult.data.sources : [])
      setSourceConfigs(Array.isArray(sourceResult.data?.source_configs) ? sourceResult.data.source_configs : [])

      const projectId = loadedContract?.projectId || loadedContract?.project_id || loadedContract?.project?._id
      if (projectId) {
        const [portfolioResult, metricCatalogResult, alertsResult] = await Promise.all([
          authenticatedFetch(`${apiUrl}/projects/${projectId}/kpis/portfolio`),
          authenticatedFetch(`${apiUrl}/projects/${projectId}/kpis/catalog`),
          authenticatedFetch(`${apiUrl}/projects/${projectId}/kpis/alerts`),
        ])
        if (!portfolioResult.error) setPortfolio(portfolioResult.data || null)
        if (!metricCatalogResult.error) setCatalogEntries(Array.isArray(metricCatalogResult.data?.entries) ? metricCatalogResult.data.entries : [])
        if (!alertsResult.error) setKpiAlerts(Array.isArray(alertsResult.data?.alerts) ? alertsResult.data.alerts : [])
      } else {
        setPortfolio(null)
        setCatalogEntries([])
        setKpiAlerts([])
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Unable to load KPI management.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [apiUrl, authChecked, authenticatedFetch, contractId, isAuthenticated])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    if (selectedSource) void loadFetchRuns(selectedSource)
  }, [loadFetchRuns, selectedSource?.source_config_id])

  useEffect(() => {
    userSourceConfigs.forEach((config) => {
      if (!sourceRuns[config.source_config_id]) void loadFetchRuns(config)
    })
  }, [loadFetchRuns, sourceRuns, userSourceConfigs])

  const updateKpi = async (kpi: ContractKPI, updates: Partial<ContractKPI>) => {
    if (!apiUrl) return null
    const normalizedUpdates: Partial<ContractKPI> = { ...updates }
    const numericUpdates = normalizedUpdates as Record<'value_min' | 'value_max' | 'consequence_value', unknown>
    ;(['value_min', 'value_max', 'consequence_value'] as const).forEach((key) => {
      const value = numericUpdates[key]
      if (value === undefined) return
      numericUpdates[key] = value === null || String(value).trim() === '' ? null : Number(value)
    })
    const previous = kpis
    setKpis((current) => current.map((item) => item.kpi_id === kpi.kpi_id ? { ...item, ...normalizedUpdates } : item))
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/${encodeURIComponent(kpi.kpi_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedUpdates),
    })
    if (result.error) {
      setKpis(previous)
      toast({ title: 'Could not update KPI', description: result.error, variant: 'destructive' })
      return null
    }
    const updated = result.data as ContractKPI
    setKpis((current) => current.map((item) => item.kpi_id === updated.kpi_id ? updated : item))
    return updated
  }

  const extractKpis = async () => {
    if (!apiUrl) return
    setIsExtracting(true)
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_drafts: true, ai_provider: 'groq' }),
    })
    setIsExtracting(false)
    if (result.error) {
      toast({ title: 'Could not extract KPIs', description: result.error, variant: 'destructive' })
      return
    }
    toast({ title: 'KPIs extracted', description: `${result.data?.kpi_count ?? result.data?.kpis?.length ?? 0} KPI candidates ready.` })
    await loadWorkspace()
  }

  const acceptAll = async () => {
    const candidates = kpis.filter((kpi) => kpi.status !== 'approved' && kpi.status !== 'ignored')
    await Promise.all(candidates.map((kpi) => updateKpi(kpi, { status: 'approved' })))
    toast({ title: 'KPI candidates accepted', description: `${candidates.length} KPI${candidates.length === 1 ? '' : 's'} accepted.` })
  }

  const trackRecommended = async () => {
    const candidates = kpis.filter((kpi) => isKpiRecommended(kpi) && !isKpiTracked(kpi) && kpi.status !== 'ignored')
    const updated = await Promise.all(candidates.map((kpi) => updateKpi(kpi, { status: 'approved', tracking_status: 'tracked', is_tracked: true })))
    const backfilled = updated.reduce((total, item) => total + Number(item?.last_tracking_backfill?.created_breach_count || 0), 0)
    await loadWorkspace()
    toast({
      title: 'Recommended KPIs tracked',
      description: backfilled ? `${backfilled} existing actual${backfilled === 1 ? '' : 's'} evaluated immediately.` : `${candidates.length} KPI${candidates.length === 1 ? '' : 's'} activated.`,
    })
  }

  const uploadActuals = async (file: File) => {
    if (!apiUrl || !token) return
    const formData = new FormData()
    formData.append('file', file)
    formData.append('evaluate', 'true')
    setIsUploading(true)
    try {
      const result = await apiUploadWithProgress<any>(`${apiUrl}/contracts/${contractId}/kpis/actuals/upload`, formData)
      if (result.error) throw new Error(result.error || 'Unable to upload actuals.')
      const payload = result.data || {}
      toast({
        title: 'Actuals ingested',
        description: `${payload.count || 0} rows mapped, ${payload.breaches?.length || 0} tracked evaluations created.`,
      })
      setActivePanel('logs')
      await loadWorkspace()
    } catch (uploadError) {
      toast({
        title: 'Actual upload failed',
        description: uploadError instanceof Error ? uploadError.message : 'Check the CSV or JSON file.',
        variant: 'destructive',
      })
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const defaultMappings = getDefaultKpiSourceMappings()

  const createSource = async (source: KPISourceCatalogItem) => {
    if (!apiUrl) return
    setIsSavingSource(true)
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: source.label,
        source_type: source.source_type,
        file_format: source.source_type === 'manual_attestation' ? 'json' : source.source_type,
        auth_type: source.auth_types?.[0] || 'none',
        status: 'draft',
        schedule: {
          cadence: 'manual',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        dedupe_key: 'record_id',
        watermark_field: 'timestamp',
        field_mappings: defaultMappings,
        validation_rules: [
          { field: 'actual_value', rule: 'required_numeric' },
          { field: 'timestamp', rule: 'required_datetime' },
        ],
      }),
    })
    setIsSavingSource(false)
    if (result.error) {
      toast({ title: 'Could not create source', description: result.error, variant: 'destructive' })
      return
    }
    setSourceConfigs((current) => [result.data, ...current])
    setSelectedSourceId(result.data.source_config_id)
  }

  const updateSource = async (config: KPISourceConfig, updates: Partial<KPISourceConfig>) => {
    if (!apiUrl) return null
    const payload = {
      ...config,
      ...updates,
      schedule: { ...(config.schedule || {}), ...(updates.schedule || {}) },
    }
    setIsSavingSource(true)
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setIsSavingSource(false)
    if (result.error) {
      toast({ title: 'Could not save source', description: result.error, variant: 'destructive' })
      return null
    }
    setSourceConfigs((current) => current.map((item) => item.source_config_id === result.data.source_config_id ? result.data : item))
    return result.data as KPISourceConfig
  }

  const toggleSourceKpi = async (config: KPISourceConfig, kpi: ContractKPI) => {
    const currentBindings = bindingsForSource(config, sortedKpis.filter((item) => item.status !== 'ignored'))
    const currentBinding = currentBindings.find((binding) => binding.kpi_id === kpi.kpi_id)
    const nextBinding = {
      ...(currentBinding || {
        binding_id: sourceBindingId(config.source_config_id, kpi.kpi_id, currentBindings.length + 1),
        kpi_id: kpi.kpi_id,
      }),
      enabled: !(currentBinding?.enabled !== false),
    }
    const nextBindings = currentBindings.map((binding) => (
      binding.kpi_id === kpi.kpi_id ? nextBinding : binding
    ))
    const nextKpiIds = Array.from(new Set(nextBindings.filter((binding) => binding.enabled !== false).map((binding) => binding.kpi_id)))
    await updateSource(config, {
      kpi_bindings: nextBindings,
      kpi_ids: nextKpiIds,
      status: nextKpiIds.length ? (config.enabled ? 'enabled' : 'mapped') : 'draft',
      field_mappings: config.field_mappings?.length ? config.field_mappings : defaultMappings,
    })
  }

  const updateSourceBinding = async (config: KPISourceConfig, nextBinding: KPISourceBinding) => {
    const visibleKpis = sortedKpis.filter((kpi) => kpi.status !== 'ignored')
    const nextBindings = upsertSourceBinding(config, visibleKpis, nextBinding)
    const nextKpiIds = Array.from(new Set(nextBindings.filter((binding) => binding.enabled !== false).map((binding) => binding.kpi_id)))
    await updateSource(config, {
      kpi_bindings: nextBindings,
      kpi_ids: nextKpiIds,
      status: nextKpiIds.length ? (config.enabled ? 'enabled' : 'mapped') : 'draft',
      field_mappings: config.field_mappings?.length ? config.field_mappings : defaultMappings,
    })
  }

  const applyIngestionMode = async (config: KPISourceConfig, mode: IngestionMode) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const baseStatus = enabledKpiIdsForSource(config, sortedKpis).length ? 'mapped' : 'ready'
    const updates: Partial<KPISourceConfig> = mode === 'scheduled'
      ? { enabled: true, status: 'enabled', schedule: { ...(config.schedule || {}), cadence: config.schedule?.cadence && config.schedule.cadence !== 'manual' ? config.schedule.cadence : 'daily', timezone } }
      : mode === 'realtime'
        ? { enabled: true, status: 'enabled', schedule: { ...(config.schedule || {}), cadence: 'webhook', timezone } }
        : mode === 'attestation'
          ? { source_type: 'manual_attestation', file_format: 'json', enabled: false, status: baseStatus, schedule: { ...(config.schedule || {}), cadence: 'manual', timezone } } as Partial<KPISourceConfig>
          : { enabled: false, status: baseStatus, schedule: { ...(config.schedule || {}), cadence: 'manual', timezone } }
    await updateSource(config, updates)
  }

  const saveSamplePayload = async (config: KPISourceConfig) => {
    const trimmed = samplePayload.trim()
    let parsed: any = trimmed || null
    if (trimmed && (config.source_type === 'json' || trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        toast({ title: 'Invalid JSON sample', description: 'Fix the payload before saving.', variant: 'destructive' })
        return
      }
    }
    await updateSource(config, { sample_payload: parsed } as Partial<KPISourceConfig>)
    toast({ title: 'Sample saved' })
  }

  const runSourceAction = async (config: KPISourceConfig, action: 'test' | 'fetch') => {
    if (!apiUrl) return
    setIsRunningSource(true)
    const payload = samplePayload.trim()
      ? (() => {
          try {
            return JSON.parse(samplePayload)
          } catch {
            return samplePayload
          }
        })()
      : undefined
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/source-configs/${encodeURIComponent(config.source_config_id)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'fetch' ? { trigger_type: 'manual', evaluate: true, payload } : { payload }),
    })
    setIsRunningSource(false)
    if (result.error) {
      toast({ title: action === 'fetch' ? 'Fetch failed' : 'Validation failed', description: result.error, variant: 'destructive' })
      return
    }
    setSourceResults((current) => ({ ...current, [config.source_config_id]: result.data }))
    if (result.data?.source_config) {
      setSourceConfigs((current) => current.map((item) => item.source_config_id === result.data.source_config.source_config_id ? result.data.source_config : item))
    }
    await Promise.all([loadWorkspace(), loadFetchRuns(config)])
    toast({ title: action === 'fetch' ? 'Source fetch complete' : 'Source validation complete' })
  }

  const flagRemediationEmail = async (breach: ContractKPIBreach) => {
    if (!apiUrl || !breach.breach_id) return null
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/breaches/${encodeURIComponent(breach.breach_id)}/flag-remediation-email`, {
      method: 'POST',
    })
    if (result.error) {
      toast({ title: 'Could not prepare escalation', description: result.error, variant: 'destructive' })
      return null
    }
    const updated = result.data as ContractKPIBreach
    setBreaches((current) => current.map((item) => item.breach_id === updated.breach_id ? updated : item))
    return updated
  }

  const certifyKpi = async (kpi: ContractKPI, governanceStatus: 'reviewed' | 'certified' | 'deprecated') => {
    if (!apiUrl) return null
    const result = await authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/${encodeURIComponent(kpi.kpi_id)}/certify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: governanceStatus, notes: `Marked ${governanceStatus} from KPI workspace.` }),
    })
    if (result.error) {
      toast({ title: 'Could not update governance', description: result.error, variant: 'destructive' })
      return null
    }
    const updated = result.data as ContractKPI
    setKpis((current) => current.map((item) => item.kpi_id === updated.kpi_id ? updated : item))
    await loadWorkspace()
    toast({ title: 'KPI governance updated', description: `${updated.name || 'KPI'} is now ${titleCase(governanceStatus)}.` })
    return updated
  }

  const createDefaultAlertRules = async () => {
    if (!apiUrl) return
    setIsCreatingAlertRules(true)
    const rules = [
      { name: 'Breach created', event_type: 'breach_created', severity_min: 'Low', channels: ['in_app'] },
      { name: 'Source stale', event_type: 'source_stale', severity_min: 'Medium', channels: ['in_app'] },
      { name: 'Missing actual', event_type: 'missing_actual', severity_min: 'Medium', channels: ['in_app'] },
      { name: 'Connector failed', event_type: 'connector_failed', severity_min: 'High', channels: ['in_app'] },
      { name: 'Upcoming deadline', event_type: 'upcoming_deadline', severity_min: 'Medium', channels: ['in_app'] },
      { name: 'Burn rate risk', event_type: 'burn_rate_risk', severity_min: 'Medium', channels: ['in_app'] },
    ]
    const results = await Promise.all(rules.map((rule) => authenticatedFetch(`${apiUrl}/contracts/${contractId}/kpis/alert-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    })))
    setIsCreatingAlertRules(false)
    const failed = results.find((result) => result.error)
    if (failed?.error) {
      toast({ title: 'Could not create alert rules', description: failed.error, variant: 'destructive' })
      return
    }
    await loadWorkspace()
    toast({ title: 'Alert rules ready', description: 'ContractSense will now surface KPI intelligence alerts for this contract.' })
  }

  const exportSnapshot = () => {
    const blob = new Blob([JSON.stringify({ contract, kpis, actuals, breaches, sourceConfigs, exported_at: new Date().toISOString() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(contract?.contract_name || 'contract').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_kpis.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!authChecked || isAuthenticated === null) {
    return <LoadingState label="Checking access..." />
  }

  if (!isAuthenticated) {
    return <LoadingState label="Redirecting..." />
  }

  const sourceResult = selectedSource ? sourceResults[selectedSource.source_config_id] : null

  return (
    <div className="min-h-screen bg-[#F9F9FF] font-InterVar text-gray-950">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void uploadActuals(file)
        }}
      />

      <header className="border-b border-gray-200 bg-white">
        <div className="px-4 py-4 md:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">

              <h1 className="truncate text-2xl font-semibold tracking-tight text-gray-950">
                {contract?.contract_name || 'Contract KPI Management'}
              </h1>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Pill tone="emerald">{trackedKpis.length} tracked</Pill>
                <Pill tone="amber">{deferredCount} deferred</Pill>
                <Pill tone={activeBreaches.length ? 'red' : 'emerald'}>{activeBreaches.length} open flags</Pill>
                <Pill tone="blue">{actuals.length} actuals</Pill>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => fileInputRef.current?.click()} disabled={isUploading || !kpis.length}>
                {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload Actuals
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={exportSnapshot} disabled={!kpis.length}>
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => void loadWorkspace()} disabled={isLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button type="button" size="sm" className="h-9 gap-1.5 bg-cs-primary text-xs text-white hover:bg-cs-primary/90" onClick={extractKpis} disabled={isExtracting}>
                {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
                Extract KPIs
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Compliance" value={`${complianceRate}%`} detail={`${Math.max(trackedKpis.length - activeBreaches.length, 0)} clear`} />
            <Metric label="Register" value={`${kpis.length}`} detail={`${summary?.total || kpis.length} extracted`} />
            <Metric label="Tracking" value={`${trackedKpis.length}/${kpis.length || 0}`} detail={`${deferredCount} deferred`} />
            <Metric label="Flags" value={`${activeBreaches.length}`} detail={`${visibleBreaches.length} evaluations`} />
            <Metric label="Exposure" value={money(exposure)} detail="current open risk" />
            <Metric label="Intelligence" value={`${openAlertCount}`} detail={`${certifiedMetricCount} certified`} />
          </div>
        </div>
      </header>

      <main className="grid gap-5 px-4 py-5 md:px-8 xl:grid-cols-[220px_1fr]">
        <aside className="h-fit rounded-lg border border-gray-200 bg-white p-2">
          {[
            { id: 'intelligence', label: 'Intelligence', icon: <Network className="h-4 w-4" />, count: openAlertCount },
            { id: 'review', label: 'Review & Track', icon: <ShieldCheck className="h-4 w-4" />, count: kpis.length },
            { id: 'sources', label: 'Actual Sources', icon: <UploadCloud className="h-4 w-4" />, count: userSourceConfigs.length },
            { id: 'flags', label: 'Compliance Flags', icon: <AlertCircle className="h-4 w-4" />, count: activeBreaches.length },
            { id: 'logs', label: 'Performance Logs', icon: <Clock className="h-4 w-4" />, count: allFetchRuns.length },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActivePanel(item.id as PanelKey)}
              className={`mb-1 flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors ${
                activePanel === item.id ? 'bg-cs-primary text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activePanel === item.id ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {item.count}
              </span>
            </button>
          ))}
        </aside>

        <section className="min-w-0">
          {isLoading ? (
            <LoadingState label="Loading KPI workspace..." embedded />
          ) : error ? (
            <div className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800">{error}</div>
          ) : activePanel === 'intelligence' ? (
            <IntelligencePanel
              portfolio={portfolio}
              catalogEntries={catalogEntries}
              alerts={kpiAlerts}
              contractId={contractId}
              onCreateDefaultAlerts={createDefaultAlertRules}
              isCreatingAlertRules={isCreatingAlertRules}
            />
          ) : activePanel === 'review' ? (
            <ReviewPanel
              kpis={sortedKpis}
              sourceConfigs={sourceConfigs}
              sourcesByKpiId={sourcesByKpiId}
              actualsByKpiId={actualsByKpiId}
              breaches={breaches}
              onAcceptAll={acceptAll}
              onTrackRecommended={trackRecommended}
              onUpdateKpi={updateKpi}
              onCertifyKpi={certifyKpi}
              onOpenClause={(kpi) => {
                const citation = kpi.citation || kpi.citation_details || {}
                const page = citation.page ?? citation.page_start ?? kpi.page_start
                const quote = quoteFor(kpi)
                const citationKey = `kpi_${kpi.kpi_id || Date.now()}`
                window.sessionStorage.setItem(`contractsense:kpiCitation:${citationKey}`, JSON.stringify({
                  quote,
                  page,
                  kpi_id: kpi.kpi_id,
                  document_id: citation.document_id || citation.doc_id || kpi.document_id || kpi.contract_id || contractId,
                  filename: citation.filename || kpi.contract_name || contract?.contract_name || null,
                }))
                router.push(`/contracts/${kpi.contract_id || contractId}?kpi_citation=${encodeURIComponent(citationKey)}`)
              }}
              recommendedTrackCount={recommendedTrackCount}
            />
          ) : activePanel === 'sources' ? (
            <SourcesPanel
              sourceCatalog={userSourceCatalog}
              sourceConfigs={userSourceConfigs}
              selectedSource={selectedSource}
              selectedRuns={selectedSource ? sourceRuns[selectedSource.source_config_id] || [] : []}
              sourceResult={sourceResult}
              kpis={sortedKpis}
              trackedKpis={trackedKpis}
              samplePayload={samplePayload}
              isSavingSource={isSavingSource}
              isRunningSource={isRunningSource}
              onSelectSource={setSelectedSourceId}
              onCreateSource={createSource}
              onUpdateSource={updateSource}
              onUpdateSourceBinding={updateSourceBinding}
              onToggleSourceKpi={toggleSourceKpi}
              onApplyIngestionMode={applyIngestionMode}
              onSaveSample={saveSamplePayload}
              onSamplePayloadChange={setSamplePayload}
              onRunSourceAction={runSourceAction}
            />
          ) : activePanel === 'flags' ? (
            <FlagsPanel breaches={visibleBreaches} kpiById={kpiById} onFlagRemediationEmail={flagRemediationEmail} />
          ) : (
            <LogsPanel
              actuals={actuals}
              kpiById={kpiById}
              sourceConfigs={userSourceConfigs}
              sourceRuns={sourceRuns}
              runDetails={runDetails}
              onLoadRunDetail={loadRunDetail}
            />
          )}
        </section>
      </main>
    </div>
  )
}

function LoadingState({ label, embedded = false }: { label: string; embedded?: boolean }) {
  return (
    <div className={`${embedded ? 'min-h-[420px]' : 'min-h-screen'} flex items-center justify-center bg-neutral-50 text-sm text-gray-500`}>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

function Pill({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'emerald' | 'amber' | 'red' | 'blue' }) {
  const classes = {
    gray: 'border-gray-200 bg-gray-50 text-gray-600',
    emerald: 'border-gray-200 bg-white text-gray-700',
    amber: 'border-gray-200 bg-gray-50 text-gray-700',
    red: 'border-gray-300 bg-white text-gray-950',
    blue: 'border-gray-200 bg-white text-gray-700',
  }[tone]
  return <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${classes}`}>{children}</span>
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-normal text-gray-950">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  )
}

function IntelligencePanel({
  portfolio,
  catalogEntries,
  alerts,
  contractId,
  onCreateDefaultAlerts,
  isCreatingAlertRules,
}: {
  portfolio: KPIPortfolio | null
  catalogEntries: KPICatalogEntry[]
  alerts: KPIAlert[]
  contractId: string
  onCreateDefaultAlerts: () => void | Promise<void>
  isCreatingAlertRules: boolean
}) {
  const summary = portfolio?.summary || {}
  const health = portfolio?.connector_health || {}
  const openAlerts = alerts.filter((alert) => String(alert.status || 'open').toLowerCase() === 'open')
  const certified = catalogEntries.filter((entry) => String(entry.certified_status || '').toLowerCase() === 'certified')

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-4">
        <Metric label="Portfolio Coverage" value={`${summary.coverage_percent ?? 0}%`} detail={`${summary.contracts_with_kpis ?? 0}/${summary.contract_count ?? 0} contracts`} />
        <Metric label="Tracked KPIs" value={`${summary.tracked_kpi_count ?? 0}`} detail={`${summary.kpi_count ?? 0} in catalog`} />
        <Metric label="Open Alerts" value={`${openAlerts.length}`} detail={`${summary.open_breach_count ?? 0} breach flags`} />
        <Metric label="Source Health" value={`${health.healthy ?? 0}`} detail={`${health.stale ?? 0} stale · ${health.failed ?? 0} failed`} />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-950">ContractSense Alerts</h2>
            <p className="mt-1 text-xs text-gray-500">Alerts are generated from contract KPI rules, source evidence, and deterministic evaluation state.</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onCreateDefaultAlerts} disabled={isCreatingAlertRules}>
            {isCreatingAlertRules ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
            Default Rules
          </Button>
        </div>
        {!alerts.length ? (
          <div className="px-4 py-8 text-sm text-gray-500">No KPI intelligence alerts yet.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {alerts.slice(0, 8).map((alert) => (
              <div key={alert.alert_id || alert.alert_key} className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_150px_140px] lg:items-center">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(alert.severity || 'medium')}`}>{titleCase(alert.severity || 'Medium')}</span>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500">{titleCase(alert.event_type || 'alert')}</span>
                  </div>
                  <p className="truncate text-sm font-semibold text-gray-950">{alert.title || 'KPI alert'}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{alert.message || 'Review this ContractSense KPI signal.'}</p>
                </div>
                <div className="text-xs text-gray-500">
                  <p className="font-semibold text-gray-800">{titleCase(alert.status || 'open')}</p>
                  <p>{formatDateTime(alert.last_seen_at || alert.created_at)}</p>
                </div>
                <Link
                  href={`/contracts/${alert.contract_id || contractId}/kpis${alert.kpi_id ? `?kpi_id=${encodeURIComponent(alert.kpi_id)}` : ''}`}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Open KPI
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 p-4">
            <div>
              <h2 className="text-base font-semibold text-gray-950">Metric Catalog</h2>
              <p className="mt-1 text-xs text-gray-500">{certified.length} certified metrics across this project.</p>
            </div>
            <Pill tone="blue">{catalogEntries.length}</Pill>
          </div>
          {!catalogEntries.length ? (
            <div className="px-4 py-8 text-sm text-gray-500">Extract or certify KPIs to populate the ContractSense metric catalog.</div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2">Governance</th>
                    <th className="px-3 py-2">Coverage</th>
                    <th className="px-3 py-2">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {catalogEntries.slice(0, 30).map((entry) => (
                    <tr key={entry.metric_key}>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-gray-950">{entry.display_name || entry.metric_key}</p>
                        <p className="mt-0.5 max-w-[360px] truncate text-[11px] text-gray-400">{entry.description || entry.metric_key}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(entry.certified_status || 'draft')}`}>
                          {titleCase(entry.certified_status || 'draft')} v{entry.version || 1}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{entry.tracked_count || 0}</span>
                          <span className="text-gray-400">of</span>
                          <span>{entry.kpi_count || 0}</span>
                        </div>
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2 text-gray-600">{entry.owner || entry.owners?.[0] || 'Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-950">Risky Contracts</h2>
            </div>
            <div className="space-y-2">
              {(portfolio?.risky_contracts || []).slice(0, 6).map((row) => (
                <Link key={String(row.contract_id)} href={`/contracts/${row.contract_id}/kpis`} className="block rounded-md border border-gray-200 bg-white px-3 py-2 hover:bg-gray-50">
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-gray-900">{row.contract_name || row.contract_id}</span>
                    <span className="text-xs font-semibold text-gray-500">{row.open_breach_count || 0} flags</span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">{row.tracked_count || 0} tracked · {row.stale_source_count || 0} stale sources</p>
                </Link>
              ))}
              {!(portfolio?.risky_contracts || []).length && <p className="text-sm text-gray-500">No risky contracts detected.</p>}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-950">Upcoming Windows</h2>
            </div>
            <div className="space-y-2">
              {(portfolio?.upcoming_reporting_windows || []).slice(0, 6).map((window) => (
                <div key={`${window.kpi_id}-${window.due_at}`} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="truncate text-xs font-semibold text-gray-900">{window.name || window.kpi_id}</p>
                  <p className="mt-1 text-[11px] text-gray-500">{formatDateTime(window.due_at)} · {titleCase(window.frequency || window.window || 'window')}</p>
                </div>
              ))}
              {!(portfolio?.upcoming_reporting_windows || []).length && <p className="text-sm text-gray-500">No reporting windows due soon.</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function ReviewPanel({
  kpis,
  sourcesByKpiId,
  actualsByKpiId,
  breaches,
  recommendedTrackCount,
  onAcceptAll,
  onTrackRecommended,
  onUpdateKpi,
  onCertifyKpi,
  onOpenClause,
}: {
  kpis: ContractKPI[]
  sourceConfigs: KPISourceConfig[]
  sourcesByKpiId: Map<string, KPISourceConfig[]>
  actualsByKpiId: Map<string, ContractKPIActual[]>
  breaches: ContractKPIBreach[]
  recommendedTrackCount: number
  onAcceptAll: () => void | Promise<void>
  onTrackRecommended: () => void | Promise<void>
  onUpdateKpi: (kpi: ContractKPI, updates: Partial<ContractKPI>) => Promise<ContractKPI | null>
  onCertifyKpi: (kpi: ContractKPI, status: 'reviewed' | 'certified' | 'deprecated') => Promise<ContractKPI | null>
  onOpenClause: (kpi: ContractKPI) => void
}) {
  const [expandedKpiId, setExpandedKpiId] = useState<string | null>(kpis.find(isKpiTracked)?.kpi_id || kpis[0]?.kpi_id || null)
  const [editingKpiId, setEditingKpiId] = useState<string | null>(null)
  
  const [activeTab, setActiveTab] = useState<'all' | 'sla' | 'penalty' | 'deadline' | 'tracked' | 'review' | 'approved'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [pagination, setPagination] = useState({ currentPage: 1, itemsPerPage: 10 })
  const breachByKpiId = useMemo(() => {
    const mapping = new Map<string, ContractKPIBreach[]>()
    breaches.forEach((breach) => {
      const list = mapping.get(breach.kpi_id) || []
      list.push(breach)
      mapping.set(breach.kpi_id, list)
    })
    return mapping
  }, [breaches])


  const getCategory = (kpi: ContractKPI) => {
    const kpiType = String(kpi.kpi_type || '').toLowerCase()
    const ruleType = String((kpi as any).rule_type || (kpi as any).rule?.rule_type || '').toLowerCase()
    if (kpiType === 'sla' || kpiType === 'performance' || ruleType === 'tiered' || ruleType === 'threshold') return 'sla'
    if (kpiType === 'penalty' || kpi.consequence_value != null) return 'penalty'
    if (kpiType === 'deadline' || kpiType === 'notice' || ruleType === 'deadline') return 'deadline'
    return 'other'
  }

  const slaCount = useMemo(() => kpis.filter((kpi) => getCategory(kpi) === 'sla').length, [kpis])
  const penaltyCount = useMemo(() => kpis.filter((kpi) => getCategory(kpi) === 'penalty').length, [kpis])
  const deadlineCount = useMemo(() => kpis.filter((kpi) => getCategory(kpi) === 'deadline').length, [kpis])
  const trackedCount = useMemo(() => kpis.filter(isKpiTracked).length, [kpis])
  const reviewCount = useMemo(() => kpis.filter((kpi) => kpi.status !== 'approved' && kpi.status !== 'ignored').length, [kpis])
  const approvedCount = useMemo(() => kpis.filter((kpi) => kpi.status === 'approved').length, [kpis])

  const filteredKpis = useMemo(() => {
    return kpis.filter((kpi) => {
      // 1. Tab filter
      if (activeTab === 'sla' && getCategory(kpi) !== 'sla') return false
      if (activeTab === 'penalty' && getCategory(kpi) !== 'penalty') return false
      if (activeTab === 'deadline' && getCategory(kpi) !== 'deadline') return false
      if (activeTab === 'tracked' && !isKpiTracked(kpi)) return false
      if (activeTab === 'review' && (kpi.status === 'approved' || kpi.status === 'ignored')) return false
      if (activeTab === 'approved' && kpi.status !== 'approved') return false

      // 2. Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const nameMatch = (kpi.name || '').toLowerCase().includes(query)
        const idMatch = (kpi.kpi_id || '').toLowerCase().includes(query)
        const sectionMatch = (kpi.structural_path || kpi.section_path || kpi.section || '').toLowerCase().includes(query)
        const partyMatch = (kpi.party || kpi.responsible_party || '').toLowerCase().includes(query)
        const quoteMatch = (quoteFor(kpi) || '').toLowerCase().includes(query)
        if (!(nameMatch || idMatch || sectionMatch || partyMatch || quoteMatch)) return false
      }
      
      return true
    })
  }, [kpis, activeTab, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredKpis.length / pagination.itemsPerPage));
  const paginatedKpis = filteredKpis.slice((pagination.currentPage - 1) * pagination.itemsPerPage, pagination.currentPage * pagination.itemsPerPage);

  if (!kpis.length) {
    return (
      <div className="flex min-h-[460px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white px-6 text-center">
        <BarChart3 className="h-8 w-8 text-gray-300" />
        <h2 className="mt-3 text-base font-semibold text-gray-950">No KPI register yet</h2>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PerformanceSummaryCards kpis={kpis} actualsByKpiId={actualsByKpiId} breaches={breaches} />

      <div className="rounded-md border bg-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border bg-[#F9FAFC] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">KPI Register</h2>
            <p className="mt-1 text-sm text-muted-foreground">{kpis.length} extracted {kpis.length === 1 ? 'KPI' : 'KPIs'}</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onAcceptAll}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Accept All
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-foreground/80" onClick={onTrackRecommended} disabled={recommendedTrackCount === 0}>
              <Play className="h-3.5 w-3.5" />
              Track Recommended
            </Button>
          </div>
        </div>
        
        {/* Category Tabs & Real-Time Search */}
        <div className="flex flex-col gap-3 p-4 border-b border-border sm:flex-row sm:items-center sm:justify-between bg-background">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: `All (${kpis.length})` },
              { id: 'sla', label: `Core SLAs (${slaCount})` },
              { id: 'penalty', label: `Penalties (${penaltyCount})` },
              { id: 'deadline', label: `Deadlines (${deadlineCount})` },
              { id: 'tracked', label: `Tracked (${trackedCount})` },
              { id: 'review', label: `To Review (${reviewCount})` },
              { id: 'approved', label: `Approved (${approvedCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setActiveTab(tab.id as any); setPagination(p => ({ ...p, currentPage: 1 })) }}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  activeTab === tab.id ? 'bg-[#015CA9] text-white shadow-sm' : 'bg-muted/50 text-gray-700 hover:bg-muted'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-700" />
              <input
                type="text"
                placeholder="Search KPI, section, quote..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPagination(p => ({ ...p, currentPage: 1 })) }}
                className="h-8 w-full rounded-md border border-gray-400 bg-[#FFFFFF] pl-8 pr-3 text-xs text-foreground outline-none focus:border-[#015CA9] focus:ring-1 focus:ring-[#015CA9]"
              />
            </div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-[#FBFCFD] hover:bg-[#FBFCFD]">
              <TableHead className="w-[60px] font-semibold text-foreground/90">S.no.</TableHead>
              <TableHead className="w-[280px] font-semibold text-foreground/90">KPI</TableHead>
              <TableHead className="font-semibold text-foreground/90">Status</TableHead>
              <TableHead className="font-semibold text-foreground/90">Threshold</TableHead>
              <TableHead className="font-semibold text-foreground/90">Sources</TableHead>
              <TableHead className="text-right pr-4 font-semibold text-foreground/90">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedKpis.map((kpi, i) => {
              const index = (pagination.currentPage - 1) * pagination.itemsPerPage + i;
              const tracked = isKpiTracked(kpi)
              const sources = sourcesByKpiId.get(kpi.kpi_id) || []
              const backfilled = Number(kpi.last_tracking_backfill?.created_breach_count || 0)
              const kpiActuals = actualsByKpiId.get(kpi.kpi_id) || []
              const kpiBreaches = breachByKpiId.get(kpi.kpi_id) || []
              const latestActual = [...kpiActuals].sort((left, right) => (
                new Date(actualTimestamp(right) || 0).getTime() - new Date(actualTimestamp(left) || 0).getTime()
              ))[0]
              const latestFlag = kpiBreaches.find((breach) => breach.is_breach) || kpiBreaches[0]
              const expanded = expandedKpiId === kpi.kpi_id
              const editing = editingKpiId === kpi.kpi_id
              return (
                <React.Fragment key={kpi.kpi_id || `${kpi.name}-${index}`}>
                  <TableRow className={`bg-[#FFFFFF] hover:bg-muted/15 transition-colors cursor-pointer ${expanded ? 'bg-muted/15' : ''}`} onClick={() => setExpandedKpiId(expanded ? null : kpi.kpi_id)}>
                    <TableCell className="align-middle py-4 text-sm font-semibold text-center text-foreground">
                      {index + 1}.
                    </TableCell>
                    <TableCell className="align-middle py-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{kpi.name}</h3>
                      </div>
                    </TableCell>
                    <TableCell className="align-middle py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${kpi.status === 'approved' ? 'border-green-200 bg-green-50 text-green-700' : statusTone(kpi.status || 'review')}`}>{titleCase(kpi.status || 'review')}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tracked ? 'border-[#015CA9]/30 bg-[#015CA9]/10 text-[#015CA9]' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>{tracked ? 'Tracked' : 'Deferred'}</span>
                        {isKpiRecommended(kpi) && !tracked && <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700">Recommended</span>}
                        {backfilled > 0 && <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700">{backfilled} backfilled</span>}
                      </div>
                    </TableCell>
                    <TableCell className="align-middle font-medium text-sm text-foreground/80">
                      {formatKpiValue(kpi)}
                    </TableCell>
                    <TableCell className="align-middle py-4">
                      <div className="flex flex-wrap gap-1">
                        {sources.length ? sources.slice(0, 3).map((source) => (
                          <span key={source.source_config_id} className="max-w-[128px] truncate rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {source.display_name}
                          </span>
                        )) : (
                          <span className="text-xs font-semibold text-muted-foreground">Not configured</span>
                        )}
                        {sources.length > 3 && <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">+{sources.length - 3}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="align-middle text-right pr-4">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {kpi.status !== 'approved' && (
                          <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-green-200 hover:bg-green-50 hover:text-green-700" onClick={(e) => { e.stopPropagation(); onUpdateKpi(kpi, { status: 'approved' }); }}>
                            Accept
                          </Button>
                        )}
                        {!tracked && kpi.status !== 'ignored' && (
                          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-[#015CA9]/30 hover:bg-[#015CA9]/10 hover:text-[#015CA9]" onClick={(e) => { e.stopPropagation(); onUpdateKpi(kpi, { status: 'approved', tracking_status: 'tracked', is_tracked: true }); }}>
                            <Play className="h-3.5 w-3.5" />
                            Track
                          </Button>
                        )}
                        {tracked && kpi.status === 'approved' && (
                          <Button type="button" variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={(e) => { e.stopPropagation(); setExpandedKpiId(expanded ? null : kpi.kpi_id); }}>
                            View
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  

                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
        
        {filteredKpis.length > 0 && (
          <div className="flex items-center justify-between border-t border-border/50 p-4">
            <p className="text-sm text-muted-foreground">
              Showing {paginatedKpis.length} of {filteredKpis.length} KPIs
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={() => setPagination(p => ({...p, currentPage: Math.max(1, p.currentPage - 1)}))} disabled={pagination.currentPage === 1}>
                Previous
              </Button>
              <span className="text-sm font-medium text-foreground">
                Page {pagination.currentPage} of {totalPages}
              </span>
              <Button variant="outline" size="sm" className="h-8" onClick={() => setPagination(p => ({...p, currentPage: Math.min(totalPages, p.currentPage + 1)}))} disabled={pagination.currentPage === totalPages}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!expandedKpiId} onOpenChange={(open) => !open && setExpandedKpiId(null)}>
        {(() => {
          const kpi = kpis.find(k => k.kpi_id === expandedKpiId)
          if (!kpi) return null
          const kpiActuals = actualsByKpiId.get(kpi.kpi_id) || []
          const kpiBreaches = breaches.filter((b) => b.kpi_id === kpi.kpi_id)
          const tracked = isKpiTracked(kpi)
          const editing = editingKpiId === kpi.kpi_id
          const latestActual = kpiActuals.length > 0 ? [...kpiActuals].sort((a, b) => new Date(actualTimestamp(b) || 0).getTime() - new Date(actualTimestamp(a) || 0).getTime())[0] : null
          const latestFlag = kpiBreaches.length > 0 ? [...kpiBreaches].sort((a, b) => new Date(b.created_at || b.timestamp || 0).getTime() - new Date(a.created_at || a.timestamp || 0).getTime())[0] : null
          const sources = sourcesByKpiId.get(kpi.kpi_id) || []
          return (
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden sm:rounded-xl p-0 gap-0">
              <DialogHeader className="sr-only">
                <DialogTitle>KPI Details</DialogTitle>
                <DialogDescription>Details for {kpi.name}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4 pr-12 shrink-0">
                <h4 className="text-sm font-semibold text-foreground">KPI Details</h4>
                <div className="flex flex-wrap items-center gap-2">
                                <span className={`inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-semibold ${statusTone(kpi.governance_status || 'draft')}`}>
                                  {titleCase(kpi.governance_status || 'Draft')}
                                </span>
                                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setEditingKpiId(editing ? null : kpi.kpi_id)}>
                                  {editing ? 'Done Editing' : 'Edit KPI'}
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-40">
                                    <DropdownMenuItem onClick={() => onCertifyKpi(kpi, 'reviewed')}>
                                      <ShieldCheck className="mr-2 h-4 w-4" /> Review
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onCertifyKpi(kpi, 'certified')}>
                                      <BookOpen className="mr-2 h-4 w-4" /> Certify
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onUpdateKpi(kpi, { status: 'ignored', is_tracked: false, tracking_status: 'ignored' })}>
                                      <AlertCircle className="mr-2 h-4 w-4" /> Remove
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-muted-foreground focus:text-muted-foreground" onClick={() => onCertifyKpi(kpi, 'deprecated')}>
                                      <Clock className="mr-2 h-4 w-4" /> Deprecate
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                <div>

                            {editing ? (
                              <div className="grid gap-4 lg:grid-cols-4">
                                <EditableKpiField label="KPI Name" value={kpi.name} onCommit={(value) => onUpdateKpi(kpi, { name: value })} wide />
                                <EditableKpiField label="Operator" value={kpi.operator || ''} onCommit={(value) => onUpdateKpi(kpi, { operator: value })} />
                                <EditableKpiField label="Unit" value={kpi.unit || ''} onCommit={(value) => onUpdateKpi(kpi, { unit: value })} />
                                <EditableKpiField label="Threshold Min" value={kpi.value_min ?? kpi.value ?? ''} onCommit={(value) => onUpdateKpi(kpi, { value_min: value as any })} />
                                <EditableKpiField label="Threshold Max" value={kpi.value_max ?? ''} onCommit={(value) => onUpdateKpi(kpi, { value_max: value as any })} />
                                <EditableKpiField label="Responsible Party" value={kpi.party || kpi.responsible_party || ''} onCommit={(value) => onUpdateKpi(kpi, { party: value })} />
                                <EditableKpiField label="Trigger" value={kpi.trigger_condition || ''} onCommit={(value) => onUpdateKpi(kpi, { trigger_condition: value })} wide />
                                <EditableKpiField label="SLA" value={kpi.remediation_sla || ''} onCommit={(value) => onUpdateKpi(kpi, { remediation_sla: value })} />
                                <EditableKpiField label="Penalty" value={kpi.consequence_value ?? ''} onCommit={(value) => onUpdateKpi(kpi, { consequence_value: value as any })} />
                                <EditableKpiField label="Remediation" value={kpi.remediation || ''} onCommit={(value) => onUpdateKpi(kpi, { remediation: value })} wide />
                              </div>
                            ) : (
                              <div className="grid gap-x-8 gap-y-6 grid-cols-2 md:grid-cols-4">
                                <DetailTile label="Latest Actual" value={latestActual ? actualLabel(latestActual, kpi) : 'No actuals'} tone={latestFlag?.is_breach ? 'amber' : 'gray'} />
                                <DetailTile label="Last Flag" value={latestFlag ? (latestFlag.is_breach ? `${severityFor(latestFlag, kpi)} · open` : 'Clear') : 'No evaluation'} tone={latestFlag?.is_breach ? 'amber' : 'gray'} />
                                <DetailTile label="Threshold" value={formatKpiValue(kpi)} tone="blue" />
                                <DetailTile label="Trigger" value={kpi.trigger_condition || 'Not specified'} tone="amber" />
                                <DetailTile label="Penalty" value={formatConsequence(kpi)} tone={kpi.consequence_value != null ? 'amber' : 'gray'} />
                                <DetailTile label="Owner" value={kpi.party || kpi.responsible_party || 'Not specified'} />
                                <DetailTile label="Governance" value={`${titleCase(kpi.governance_status || 'draft')} v${kpi.governance_version || 1}`} tone={kpi.governance_status === 'certified' ? 'blue' : 'gray'} />
                                <DetailTile label="Sources" value={sources.length ? `${sources.length} assigned` : 'None'} tone={sources.length ? 'blue' : 'amber'} />
                              </div>
                            )}
                          </div>

                          {/* Contract Evidence (Priority 2) */}
                          <div className="border-t border-border pt-6 mt-6">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-sm font-semibold text-foreground">Contract Evidence</h4>
                              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onOpenClause(kpi)}>
                                <FileText className="h-3.5 w-3.5" />
                                Refer Contract
                              </Button>
                            </div>
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground">{kpi.structural_path || kpi.section_path || kpi.section || 'Clause location not captured'}</p>
                              <blockquote className="border-l-2 border-muted pl-4 text-sm leading-relaxed text-foreground/90 max-h-32 overflow-auto">
                                {quoteFor(kpi) || kpi.confidence_reason || kpi.recommendation_reason || 'No source quote captured.'}
                              </blockquote>
                            </div>
                          </div>
                    {(() => {
                      const cattrs = (kpi as any).custom_attributes || {};
                      const rawKeys = Object.keys(cattrs);

                      // Standard system keys to ignore (since they are rendered elsewhere in the card)
                      const ignoredKeys = new Set([
                        'clause_text', 'quote', 'source_quote', 'run_id', 'document_id', 'user_id',
                        'citation', 'citation_details', 'breach_email_template', 'value_candidates',
                        'source_requirements', 'rule_version', 'ai_generated_only_at_extraction',
                        'ai_extraction_provider', 'char_start', 'char_end', 'chunk_id', 'chunk_level',
                        'source_chunk_level', 'definition', 'formula', 'confidence', 'confidence_reason',
                        'needs_review', 'extraction_method'
                      ]);

                      // Flatten any inner 'custom_attributes' dictionary if present
                      const flattenedAttrs: Record<string, any> = {};
                      const processObj = (obj: Record<string, any>, prefix = '') => {
                        for (const [k, v] of Object.entries(obj)) {
                          if (ignoredKeys.has(k) || v == null || v === '') continue;
                          if (k === 'custom_attributes' && typeof v === 'object') {
                            processObj(v, prefix);
                          } else if (prefix) {
                            flattenedAttrs[`${prefix}_${k}`] = v;
                          } else {
                            flattenedAttrs[k] = v;
                          }
                        }
                      };
                      processObj(cattrs);

                      const attrEntries = Object.entries(flattenedAttrs);
                      if (attrEntries.length === 0) return null;

                      return (
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50/40 p-2.5 text-xs">
                          <span className="font-bold text-indigo-900 uppercase tracking-wide text-[10px] mr-1 flex items-center gap-1">
                            <Layers className="h-3 w-3 text-indigo-600" /> Domain Attributes:
                          </span>
                          {attrEntries.map(([attrKey, attrVal]) => {
                            const formattedKey = titleCase(attrKey.replace(/_/g, ' '));
                            
                            // 1. Primitive string/number/boolean
                            if (typeof attrVal !== 'object') {
                              const isPenalty = attrKey.includes('penalty');
                              const isWindow = attrKey.includes('window');
                              const toneBg = isPenalty ? 'bg-rose-100/80 text-rose-900' : isWindow ? 'bg-blue-100/80 text-blue-900' : 'bg-indigo-100/80 text-indigo-900';
                              return (
                                <span key={attrKey} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${toneBg}`}>
                                  <span className="font-semibold opacity-75">{formattedKey}:</span> {String(attrVal)}
                                </span>
                              );
                            }

                            // 2. Array of primitives or objects
                            if (Array.isArray(attrVal)) {
                              if (attrVal.length === 0) return null;
                              const displayStr = attrVal.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ');
                              return (
                                <span key={attrKey} className="inline-flex items-center gap-1 rounded bg-indigo-100/80 px-2 py-0.5 font-medium text-indigo-900">
                                  <span className="font-semibold opacity-75">{formattedKey}:</span> {displayStr}
                                </span>
                              );
                            }

                            // 3. Nested dictionary object
                            const subEntries = Object.entries(attrVal).filter(([_, v]) => v != null && v !== '');
                            if (subEntries.length === 0) return null;

                            return subEntries.map(([subK, subV]) => {
                              const subLabel = `${formattedKey} (${titleCase(subK.replace(/_/g, ' '))})`;
                              const subValStr = typeof subV === 'object' ? JSON.stringify(subV) : String(subV);
                              return (
                                <span key={`${attrKey}.${subK}`} className="inline-flex items-center gap-1 rounded bg-indigo-100/80 px-2 py-0.5 font-medium text-indigo-900">
                                  <span className="font-semibold opacity-75">{subLabel}:</span> {subValStr}
                                </span>
                              );
                            });
                          })}
                        </div>
                      );
                    })()}


                          {/* Historical Logs (Priority 4) */}
                          <KpiBreachStrip kpi={kpi} breaches={kpiBreaches} />

                          {/* Advanced SLA/SLO Policy (Priority 5) */}
                          <SlaPolicyStrip kpi={kpi} />


                                                    {tracked && (
                            <>
    {/* Monitoring (Priority 3) */}
                          {tracked ? (
                            <div className="border-t border-border pt-6 mt-6">
                              <h4 className="mb-4 text-sm font-semibold text-foreground">Monitoring</h4>
                                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
                                  <KpiHistoryChart kpi={kpi} actuals={kpiActuals} breaches={kpiBreaches} />
                                  <KpiActualHistory kpi={kpi} actuals={kpiActuals} />
                                </div>
                            </div>
                          ) : (
                            <div className="border-t border-border pt-6 mt-6">
                              <h4 className="mb-4 text-sm font-semibold text-foreground">Monitoring</h4>
                              <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-600">
                                This KPI is accepted or pending but not actively tracked. Use Track to start evaluating historical actuals and future source runs.
                              </div>
                            </div>
                          )}

                          {/* Historical Logs (Priority 4) */}
                          <KpiBreachStrip kpi={kpi} breaches={kpiBreaches} />

                          
                            </>
                          )}

                          {/* Advanced SLA/SLO Policy (Priority 5) */}
                          <SlaPolicyStrip kpi={kpi} />
                        </div>
            </DialogContent>
          )
        })()}
      </Dialog>
    </div>
  )
}

function PerformanceSummaryCards({
  kpis,
  actualsByKpiId,
  breaches,
}: {
  kpis: ContractKPI[]
  actualsByKpiId: Map<string, ContractKPIActual[]>
  breaches: ContractKPIBreach[]
}) {
  const tracked = kpis.filter(isKpiTracked)
  const actuals = Array.from(actualsByKpiId.values()).flat()
  const openFlags = breaches.filter((breach) => breach.is_breach && breach.status !== 'resolved')
  const typeCounts = kpis.reduce<Record<string, number>>((acc, kpi) => {
    const label = titleCase(kpi.kpi_type || 'other')
    acc[label] = (acc[label] || 0) + 1
    return acc
  }, {})

  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-950">Performance Trend</h3>
          <Pill tone="blue">{actuals.length} actuals</Pill>
        </div>
        <OverallSparkline actuals={actuals} />
      </section>
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-950">KPI Coverage</h3>
          <Pill tone="emerald">{tracked.length}/{kpis.length}</Pill>
        </div>
        <HorizontalMiniBars values={Object.entries(typeCounts).map(([label, value]) => ({ label, value }))} />
      </section>
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-950">Compliance Flags</h3>
          <Pill tone={openFlags.length ? 'red' : 'emerald'}>{openFlags.length} open</Pill>
        </div>
        <FlagDonut open={openFlags.length} clear={Math.max(tracked.length - openFlags.length, 0)} />
      </section>
    </div>
  )
}

function OverallSparkline({ actuals }: { actuals: ContractKPIActual[] }) {
  const points = chartPointsFor(actuals).slice(-18)
  return <Sparkline values={points.length ? points.map((point) => point.value) : [0, 0, 0, 0]} labels={points.map((point) => point.xLabel)} heightClass="h-36" />
}

function HorizontalMiniBars({ values }: { values: Array<{ label: string; value: number }> }) {
  const rows = values.length ? values : [{ label: 'No extracted KPIs', value: 1 }]
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <div className="space-y-3">
      {rows.slice(0, 5).map((row, index) => (
        <div key={row.label}>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span className="truncate text-gray-600">{row.label}</span>
            <span className="font-semibold text-gray-950">{row.value}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(8, (row.value / max) * 100)}%` }}
              transition={{ duration: 0.8, delay: index * 0.1, ease: 'easeOut' }}
              className="h-2 rounded-full bg-blue-600"
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function FlagDonut({ open, clear }: { open: number; clear: number }) {
  const total = Math.max(open + clear, 1)
  const openPercent = (open / total) * 100
  return (
    <div className="flex items-center gap-4">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative h-28 w-28 shrink-0 rounded-full shadow-sm"
        style={{ background: `conic-gradient(#ef4444 0 ${openPercent}%, #e5e7eb ${openPercent}% 100%)` }}
      >
        <div className="absolute inset-7 flex items-center justify-center rounded-full bg-white text-lg font-semibold text-gray-950">{open}</div>
      </motion.div>
      <div className="space-y-2 text-xs text-gray-600">
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm" /> Open flags <strong>{open}</strong></div>
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-gray-300" /> Clear tracked <strong>{clear}</strong></div>
      </div>
    </div>
  )
}

function EditableKpiField({
  label,
  value,
  onCommit,
  wide = false,
}: {
  label: string
  value: string | number | null
  onCommit: (value: string) => unknown | Promise<unknown>
  wide?: boolean
}) {
  return (
    <label className={`block rounded-md border border-gray-200 bg-white px-3 py-2 ${wide ? 'lg:col-span-2' : ''}`}>
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</span>
      <input
        defaultValue={value ?? ''}
        onBlur={(event) => {
          const next = event.target.value
          if (next !== String(value ?? '')) void onCommit(next)
        }}
        className="mt-1 h-8 w-full border-0 bg-transparent p-0 text-sm font-semibold text-gray-900 outline-none focus:ring-0"
      />
    </label>
  )
}

function KpiHistoryChart({ kpi, actuals, breaches }: { kpi: ContractKPI; actuals: ContractKPIActual[]; breaches: ContractKPIBreach[] }) {
  const points = chartPointsFor(actuals)
  const latestBreach = breaches.find((breach) => breach.is_breach)
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-950">Tracked Performance</h4>
          <p className="mt-1 text-xs text-gray-500">Historical actuals against the contract threshold.</p>
        </div>
        <Pill tone={latestBreach ? 'red' : 'emerald'}>{latestBreach ? 'Flagged' : 'Monitoring'}</Pill>
      </div>
      <Sparkline
        values={points.length ? points.map((point) => point.value) : []}
        labels={points.map((point) => point.xLabel)}
        threshold={toNumber(kpi.value_min ?? kpi.value)}
        heightClass="h-44"
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <DetailTile label="Target" value={formatKpiValue(kpi)} tone="blue" />
        <DetailTile label="Latest" value={actuals.length ? actualLabel([...actuals].sort((left, right) => new Date(actualTimestamp(right) || 0).getTime() - new Date(actualTimestamp(left) || 0).getTime())[0], kpi) : 'No actual'} />
        <DetailTile label="Samples" value={`${actuals.length}`} />
      </div>
    </section>
  )
}

function Sparkline({ values, labels, threshold, heightClass }: { values: number[]; labels?: string[]; threshold?: number | null; heightClass: string }) {
  const data = values.length >= 2 ? values : values.length === 1 ? [values[0], values[0]] : [0, 0]
  const thresholdValue = threshold ?? undefined
  const min = Math.min(...data, thresholdValue ?? data[0], 0)
  const max = Math.max(...data, thresholdValue ?? data[0], 1)
  const range = Math.max(max - min, 1)
  const coords = data.map((value, index) => {
    const x = (index / Math.max(data.length - 1, 1)) * 320
    const y = 150 - ((value - min) / range) * 120
    return `${x},${y}`
  }).join(' ')
  const thresholdY = thresholdValue == null ? null : 150 - ((thresholdValue - min) / range) * 120

  return (
    <div className={`${heightClass} rounded-md border border-gray-200 bg-white p-3 shadow-sm`}>
      {values.length ? (
        <svg viewBox="0 0 320 170" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
          <line x1="0" y1="150" x2="320" y2="150" stroke="#e5e7eb" />
          {thresholdY != null && (
            <>
              <line x1="0" y1={thresholdY} x2="320" y2={thresholdY} stroke="#9ca3af" strokeDasharray="6 5" />
              <text x="4" y={Math.max(12, thresholdY - 6)} fill="#6b7280" fontSize="10">target {thresholdValue}</text>
            </>
          )}
          <motion.polyline
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
            points={coords}
            fill="none"
            stroke="url(#sparkline-gradient)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {data.map((value, index) => {
            const [x, y] = coords.split(' ')[index].split(',').map(Number)
            return (
              <motion.circle
                key={`${value}-${index}`}
                cx={x}
                cy={y}
                r="3.5"
                fill="#4f46e5"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, delay: index * 0.05 + 0.5 }}
              />
            )
          })}
          {labels?.length ? <text x="0" y="168" fill="#6b7280" fontSize="10">{labels[0]}</text> : null}
          {labels?.length ? <text x="320" y="168" textAnchor="end" fill="#6b7280" fontSize="10">{labels[labels.length - 1]}</text> : null}
        </svg>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-gray-400">No actual history yet.</div>
      )}
    </div>
  )
}

function KpiActualHistory({ kpi, actuals }: { kpi: ContractKPI; actuals: ContractKPIActual[] }) {
  const rows = [...actuals].sort((left, right) => new Date(actualTimestamp(right) || 0).getTime() - new Date(actualTimestamp(left) || 0).getTime())
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h4 className="text-sm font-semibold text-gray-950">Historical Actual Logs</h4>
        <p className="mt-1 text-xs text-gray-500">Stored actuals for this tracked KPI.</p>
      </div>
      {!rows.length ? (
        <div className="px-4 py-10 text-center text-sm text-gray-400">No actual logs recorded yet.</div>
      ) : (
        <div className="max-h-[240px] overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2">Actual</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((actual) => (
                <tr key={actual.actual_id || `${actual.kpi_id}-${actualTimestamp(actual)}`}>
                  <td className="px-3 py-2 font-mono text-gray-900">{actualLabel(actual, kpi)}</td>
                  <td className="max-w-[160px] truncate px-3 py-2 text-gray-600">{actual.source || 'manual'}</td>
                  <td className="px-3 py-2 text-gray-500">{formatDateTime(actualTimestamp(actual))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function KpiBreachStrip({ kpi, breaches }: { kpi: ContractKPI; breaches: ContractKPIBreach[] }) {
  if (breaches.length === 0) {
    return null
  }
  return (
    <div className="mt-6">
      <h5 className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Compliance Evaluations</h5>
      <RecordPreviewTable rows={breaches} empty="No evaluations" />
    </div>
  )
}

function SlaPolicyStrip({ kpi }: { kpi: ContractKPI }) {
  const businessHoursEnabled = Boolean(kpi.business_hours?.enabled || kpi.business_hours?.business_days_only)
  const blackoutCount = Array.isArray(kpi.blackout_windows) ? kpi.blackout_windows.length : 0
  const lockDays = kpi.reporting_lock?.lock_after_days
  const errorBudget = kpi.error_budget || {}
  const hasPolicy = businessHoursEnabled || blackoutCount || lockDays || kpi.missing_data_policy || Object.keys(errorBudget).length
  if (!hasPolicy) return null
  const budgetText = Object.keys(errorBudget).length
    ? `${errorBudget.consumed ?? 0}/${errorBudget.budget ?? errorBudget.allowed ?? 'budget'}`
    : 'Not configured'
  return (
    <details className="border-t border-border pt-6 mt-6 group">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground hover:text-muted-foreground list-none [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-4 w-4 transition-transform group-open:-rotate-180" />
        Advanced SLA/SLO Policy
      </summary>
      <div className="mt-4 grid gap-x-8 gap-y-6 grid-cols-2 xl:grid-cols-5 pl-6">
        <DetailTile label="Business Hours" value={businessHoursEnabled ? `${kpi.business_hours?.start || '09:00'}-${kpi.business_hours?.end || '17:00'}` : 'Calendar time'} tone={businessHoursEnabled ? 'blue' : 'gray'} />
        <DetailTile label="Blackouts" value={blackoutCount ? `${blackoutCount} window${blackoutCount === 1 ? '' : 's'}` : 'None'} tone={blackoutCount ? 'amber' : 'gray'} />
        <DetailTile label="Reporting Lock" value={lockDays ? `${lockDays} day${Number(lockDays) === 1 ? '' : 's'}` : 'Unlocked'} />
        <DetailTile label="Missing Data" value={titleCase(kpi.missing_data_policy || 'flag missing evidence')} tone="amber" />
        <DetailTile label="Error Budget" value={budgetText} tone={Object.keys(errorBudget).length ? 'blue' : 'gray'} />
      </div>
    </details>
  )
}

function DetailTile({ label, value, tone = 'gray' }: { label: string; value: string; tone?: 'gray' | 'blue' | 'amber' }) {
  const textColor = {
    gray: 'text-foreground',
    blue: 'text-[#015CA9]',
    amber: 'text-amber-700',
  }[tone]
  return (
    <div className="min-w-0 flex flex-col gap-1">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className={`truncate text-sm font-semibold ${textColor}`}>{value}</p>
    </div>
  )
}

function displayCell(value: any) {
  if (value == null || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function previewColumns(rows: Array<Record<string, any>>) {
  const preferred = ['row', 'kpi_id', 'kpi_name', 'actual_value', 'value', 'unit', 'timestamp', 'period', 'source_record_id', 'record_id', 'reason', 'actual_id', 'status']
  const keys = new Set<string>()
  rows.slice(0, 8).forEach((row) => Object.keys(row || {}).forEach((key) => keys.add(key)))
  const ordered = preferred.filter((key) => keys.has(key))
  Array.from(keys).forEach((key) => {
    if (!ordered.includes(key) && ordered.length < 7) ordered.push(key)
  })
  return ordered.length ? ordered : preferred.slice(0, 5)
}

function RecordPreviewTable({ rows, empty }: { rows: Array<Record<string, any>>; empty: string }) {
  if (!rows.length) {
    return <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-sm text-gray-400">{empty}</div>
  }
  const columns = previewColumns(rows)
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-gray-200 bg-white">
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
          <tr>
            {columns.map((column) => <th key={column} className="px-3 py-2">{column.replace(/_/g, ' ')}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.slice(0, 50).map((row, rowIndex) => (
            <tr key={`${row.actual_id || row.source_record_id || row.record_id || rowIndex}`} className="bg-white">
              {columns.map((column) => (
                <td key={column} className="max-w-[220px] truncate px-3 py-2 text-gray-700" title={displayCell(row[column])}>
                  {displayCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">Showing 50 of {rows.length} rows.</div>}
    </div>
  )
}

function RunPreviewBlock({ title, rows, empty }: { title: string; rows: Array<Record<string, any>>; empty: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{title}</p>
        <span className="text-xs font-semibold text-gray-500">{rows.length}</span>
      </div>
      <RecordPreviewTable rows={rows} empty={empty} />
    </div>
  )
}

function SourceKpiBindingEditor({
  config,
  kpis,
  selectedBindingKpiId,
  disabled,
  onSelectBinding,
  onToggleSourceKpi,
  onUpdateBinding,
}: {
  config: KPISourceConfig
  kpis: ContractKPI[]
  selectedBindingKpiId?: string | null
  disabled: boolean
  onSelectBinding: (kpiId: string) => void
  onToggleSourceKpi: (config: KPISourceConfig, kpi: ContractKPI) => void | Promise<void>
  onUpdateBinding: (config: KPISourceConfig, binding: KPISourceBinding) => void | Promise<void>
}) {
  if (!kpis.length) {
    return <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">No KPI rows available to assign.</div>
  }

  const bindings = bindingsForSource(config, kpis)
  const enabledCount = bindings.filter((binding) => binding.enabled !== false).length
  const sourceFieldOptions = detectKpiSourceFields({
    fieldMappings: [
      ...normalizeFieldMappings(config.field_mappings),
      ...bindings.flatMap((binding) => normalizeFieldMappings(binding.field_mappings)),
    ],
    recordPath: config.record_path,
    samplePayload: config.sample_payload,
    schemaFields: config.schema_fields,
  })
  const inputListId = `${config.source_config_id}-binding-source-fields`
  const saveBinding = (binding: KPISourceBinding, updates: Partial<KPISourceBinding>) => {
    void onUpdateBinding(config, { ...binding, ...updates })
  }
  const updateMapping = (
    binding: KPISourceBinding,
    kpiField: string,
    sourceField: string,
    transform: string,
  ) => {
    const baseMappings = binding.field_mappings?.length
      ? binding.field_mappings
      : normalizeFieldMappings(config.field_mappings?.length ? config.field_mappings : getDefaultKpiSourceMappings())
    saveBinding(binding, {
      enabled: true,
      field_mappings: setFieldMapping(baseMappings, kpiField, sourceField, transform),
    })
  }
  const updateMatchRule = (binding: KPISourceBinding, field: string, value: string) => {
    const cleanField = field.trim()
    const cleanValue = value.trim()
    saveBinding(binding, {
      match_rule: cleanField || cleanValue
        ? { field: cleanField || 'kpi_id', operator: 'equals', value: cleanValue }
        : {},
    })
  }

  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-gray-200">
      <datalist id={inputListId}>
        {sourceFieldOptions.map((fieldName) => <option key={fieldName} value={fieldName} />)}
      </datalist>
      <table className="min-w-[980px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
          <tr>
            <th className="min-w-[230px] px-3 py-2">KPI</th>
            <th className="w-24 px-3 py-2">Enabled</th>
            <th className="min-w-[210px] px-3 py-2">Match Rule</th>
            <th className="min-w-[150px] px-3 py-2">Actual Value</th>
            <th className="min-w-[145px] px-3 py-2">Timestamp</th>
            <th className="min-w-[120px] px-3 py-2">Unit</th>
            <th className="min-w-[110px] px-3 py-2">Aggregation</th>
            <th className="min-w-[120px] px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {kpis.map((kpi, index) => {
            const binding = bindings[index]
            const selected = selectedBindingKpiId === kpi.kpi_id
            const effectiveMappings = bindingEffectiveMappings(config, binding)
            const status = bindingStatus(config, binding, enabledCount)
            const matchField = String(binding.match_rule?.field || '')
            const matchValue = String(binding.match_rule?.value || '')
            return (
              <tr key={kpi.kpi_id} className={`align-top ${selected ? 'bg-gray-50' : ''}`}>
                <td className="px-3 py-2" onClick={() => onSelectBinding(kpi.kpi_id)}>
                  <p className="font-mono text-[10px] font-semibold text-gray-400">{kpiCode(kpi, index)}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-gray-900">{kpi.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-gray-400">{formatKpiValue(kpi)}</p>
                </td>
                <td className="px-3 py-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-700">
                    <input
                      type="checkbox"
                      checked={binding.enabled !== false}
                      disabled={disabled}
                      onChange={() => {
                        onSelectBinding(kpi.kpi_id)
                        void onToggleSourceKpi(config, kpi)
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-gray-950 focus:ring-gray-950"
                    />
                    <span>{binding.enabled !== false ? 'On' : 'Off'}</span>
                  </label>
                </td>
                <td className="px-3 py-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
                    <input
                      list={inputListId}
                      defaultValue={matchField}
                      placeholder="field"
                      disabled={disabled || binding.enabled === false}
                      onFocus={() => onSelectBinding(kpi.kpi_id)}
                      onBlur={(event) => updateMatchRule(binding, event.target.value, matchValue)}
                      className="h-8 rounded-md border border-gray-200 bg-white px-2 font-mono text-[11px] text-gray-700"
                    />
                    <input
                      defaultValue={matchValue}
                      placeholder="value"
                      disabled={disabled || binding.enabled === false}
                      onFocus={() => onSelectBinding(kpi.kpi_id)}
                      onBlur={(event) => updateMatchRule(binding, matchField, event.target.value)}
                      className="h-8 rounded-md border border-gray-200 bg-white px-2 font-mono text-[11px] text-gray-700"
                    />
                  </div>
                </td>
                {([
                  ['actual_value', 'value', 'number'],
                  ['timestamp', 'timestamp', 'datetime'],
                  ['unit', 'unit', 'string'],
                ] as const).map(([kpiField, placeholder, transform]) => (
                  <td key={kpiField} className="px-3 py-2">
                    <input
                      list={inputListId}
                      defaultValue={sourceFieldFor(effectiveMappings, kpiField)}
                      placeholder={placeholder}
                      disabled={disabled || binding.enabled === false}
                      onFocus={() => onSelectBinding(kpi.kpi_id)}
                      onBlur={(event) => updateMapping(binding, kpiField, event.target.value, transform)}
                      className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-[11px] text-gray-700"
                    />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <select
                    value={binding.aggregation || 'latest'}
                    disabled={disabled || binding.enabled === false}
                    onFocus={() => onSelectBinding(kpi.kpi_id)}
                    onChange={(event) => saveBinding(binding, { aggregation: event.target.value, enabled: true })}
                    className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-[11px] font-semibold text-gray-700"
                  >
                    <option value="latest">Latest</option>
                    <option value="average">Average</option>
                    <option value="sum">Sum</option>
                    <option value="min">Min</option>
                    <option value="max">Max</option>
                    <option value="count">Count</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onSelectBinding(kpi.kpi_id)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(status)}`}
                  >
                    {bindingStatusLabel(status)}
                  </button>
                  <div className="mt-1 flex gap-1">
                    <button
                      type="button"
                      disabled={disabled || binding.enabled === false}
                      onClick={() => saveBinding(binding, { field_mappings: [], enabled: true })}
                      className="text-[10px] font-semibold text-gray-500 hover:text-gray-950 disabled:opacity-40"
                    >
                      Defaults
                    </button>
                    <button
                      type="button"
                      disabled={disabled || binding.enabled === false}
                      onClick={() => saveBinding(binding, { field_mappings: normalizeFieldMappings(config.field_mappings?.length ? config.field_mappings : getDefaultKpiSourceMappings()), enabled: true })}
                      className="text-[10px] font-semibold text-gray-700 hover:text-gray-950 disabled:opacity-40"
                    >
                      Override
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SourcesPanel({
  sourceCatalog,
  sourceConfigs,
  selectedSource,
  selectedRuns,
  sourceResult,
  kpis,
  trackedKpis,
  samplePayload,
  isSavingSource,
  isRunningSource,
  onSelectSource,
  onCreateSource,
  onUpdateSource,
  onUpdateSourceBinding,
  onToggleSourceKpi,
  onApplyIngestionMode,
  onSaveSample,
  onSamplePayloadChange,
  onRunSourceAction,
}: {
  sourceCatalog: KPISourceCatalogItem[]
  sourceConfigs: KPISourceConfig[]
  selectedSource: KPISourceConfig | null
  selectedRuns: KPISourceFetchRun[]
  sourceResult: any
  kpis: ContractKPI[]
  trackedKpis: ContractKPI[]
  samplePayload: string
  isSavingSource: boolean
  isRunningSource: boolean
  onSelectSource: (sourceId: string) => void
  onCreateSource: (source: KPISourceCatalogItem) => void | Promise<void>
  onUpdateSource: (config: KPISourceConfig, updates: Partial<KPISourceConfig>) => void | Promise<KPISourceConfig | null>
  onUpdateSourceBinding: (config: KPISourceConfig, binding: KPISourceBinding) => void | Promise<void>
  onToggleSourceKpi: (config: KPISourceConfig, kpi: ContractKPI) => void | Promise<void>
  onApplyIngestionMode: (config: KPISourceConfig, mode: IngestionMode) => void | Promise<void>
  onSaveSample: (config: KPISourceConfig) => void | Promise<void>
  onSamplePayloadChange: (value: string) => void
  onRunSourceAction: (config: KPISourceConfig, action: 'test' | 'fetch') => void | Promise<void>
}) {
  const visibleKpis = kpis.filter((kpi) => kpi.status !== 'ignored')
  const selectedBindings = selectedSource ? bindingsForSource(selectedSource, visibleKpis) : []
  const enabledBindings = selectedBindings.filter((binding) => binding.enabled !== false)
  const [selectedBindingKpiId, setSelectedBindingKpiId] = useState<string | null>(null)
  const selectedBinding = selectedBindings.find((binding) => binding.kpi_id === selectedBindingKpiId)
    || enabledBindings[0]
    || selectedBindings[0]
    || null
  const selectedBindingKpi = selectedBinding ? visibleKpis.find((kpi) => kpi.kpi_id === selectedBinding.kpi_id) || null : null
  const selectedKpiCount = enabledBindings.length

  useEffect(() => {
    if (!selectedSource) {
      setSelectedBindingKpiId(null)
      return
    }
    const bindings = bindingsForSource(selectedSource, visibleKpis)
    const stillVisible = bindings.some((binding) => binding.kpi_id === selectedBindingKpiId)
    if (!stillVisible) {
      setSelectedBindingKpiId(
        bindings.find((binding) => binding.enabled !== false)?.kpi_id
        || bindings[0]?.kpi_id
        || null
      )
    }
  }, [selectedSource?.source_config_id, selectedBindingKpiId, visibleKpis])

  const updateMapping = (field: string, sourceField: string, transform?: string) => {
    if (!selectedSource || !selectedBinding) return
    const baseMappings = selectedBinding.field_mappings?.length
      ? selectedBinding.field_mappings
      : normalizeFieldMappings(selectedSource.field_mappings?.length ? selectedSource.field_mappings : getDefaultKpiSourceMappings())
    const field_mappings = setFieldMapping(baseMappings, field, sourceField, transform || mappingForField(baseMappings, field)?.transform || 'string')
    void onUpdateSourceBinding(selectedSource, {
      ...selectedBinding,
      enabled: true,
      field_mappings,
    })
  }
  const useSelectedBindingDefaults = () => {
    if (!selectedSource || !selectedBinding) return
    void onUpdateSourceBinding(selectedSource, { ...selectedBinding, field_mappings: [] })
  }
  const overrideSelectedBinding = () => {
    if (!selectedSource || !selectedBinding) return
    void onUpdateSourceBinding(selectedSource, {
      ...selectedBinding,
      enabled: true,
      field_mappings: normalizeFieldMappings(selectedSource.field_mappings?.length ? selectedSource.field_mappings : getDefaultKpiSourceMappings()),
    })
  }
  const updateSourceDefaultMapping = (field: string, sourceField: string, transform?: string) => {
    if (!selectedSource) return
    const field_mappings = setFieldMapping(selectedSource.field_mappings, field, sourceField, transform || mappingForField(selectedSource.field_mappings, field)?.transform || 'string')
    void onUpdateSource(selectedSource, { field_mappings })
  }
  const selectedMapperMappings = selectedSource && selectedBinding
    ? bindingEffectiveMappings(selectedSource, selectedBinding)
    : selectedSource?.field_mappings || []
  const selectedBindingHasOverrides = Boolean(selectedBinding?.field_mappings?.length)
  const updateSelectedBindingValue = (updates: Partial<KPISourceBinding>) => {
    if (!selectedSource || !selectedBinding) return
    void onUpdateSourceBinding(selectedSource, { ...selectedBinding, ...updates })
  }
  const validationRows = sourceResult?.normalized_rows || sourceResult?.fetch_run?.normalized_preview || []
  const skippedRows = sourceResult?.skipped_rows || []

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-950">Sources</h2>
            <Pill tone="blue">{sourceConfigs.length}</Pill>
          </div>
          <div className="space-y-2">
            {sourceConfigs.length ? sourceConfigs.map((config) => (
              <button
                key={config.source_config_id}
                type="button"
                onClick={() => onSelectSource(config.source_config_id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedSource?.source_config_id === config.source_config_id ? 'border-gray-400 bg-gray-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-950">{config.display_name}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{titleCase(config.source_type)} · {enabledKpiIdsForSource(config, visibleKpis).length} KPI{enabledKpiIdsForSource(config, visibleKpis).length === 1 ? '' : 's'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(config.last_error ? 'failed' : config.status || 'draft')}`}>
                    {titleCase(config.last_error ? 'failed' : config.status || 'draft')}
                  </span>
                </div>
              </button>
            )) : (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">No sources yet.</div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="mb-3 text-sm font-semibold text-gray-950">Add Source</h2>
          <div className="grid gap-2">
            {sourceCatalog.map((source) => (
              <button
                key={source.source_type}
                type="button"
                onClick={() => onCreateSource(source)}
                disabled={isSavingSource}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-400 hover:bg-gray-50 disabled:opacity-60"
              >
                <span>
                  <span className="block text-sm font-semibold text-gray-900">{source.label}</span>
                  <span className="block text-xs text-gray-400">{titleCase(source.source_type)}</span>
                </span>
                <Plus className="h-4 w-4 text-gray-400" />
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="min-w-0 rounded-lg border border-gray-200 bg-white">
        {selectedSource ? (
          <div key={selectedSource.source_config_id} className="divide-y divide-gray-100">
            <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-gray-950">{selectedSource.display_name}</h2>
                <p className="mt-1 text-sm text-gray-500">{titleCase(selectedSource.source_type)} · {ingestionModeLabel(selectedSource)} · last success {selectedSource.last_success_at || 'not yet'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(selectedSource.last_error ? 'failed' : selectedSource.status || 'draft')}`}>
                  {titleCase(selectedSource.last_error ? 'failed' : selectedSource.status || 'draft')}
                </span>
                <Pill tone={selectedKpiCount ? 'blue' : 'amber'}>{selectedKpiCount} assigned</Pill>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
                <section className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">1 · Assign KPIs</p>
                      <p className="mt-1 text-xs text-gray-500">Select exactly which KPIs each source can feed. A KPI can use multiple sources.</p>
                    </div>
                    <Pill tone={selectedKpiCount ? 'blue' : 'amber'}>{selectedKpiCount}/{visibleKpis.length} on this source</Pill>
                  </div>
                  <SourceKpiBindingEditor
                    config={selectedSource}
                    kpis={visibleKpis}
                    selectedBindingKpiId={selectedBinding?.kpi_id || null}
                    disabled={isSavingSource}
                    onSelectBinding={setSelectedBindingKpiId}
                    onToggleSourceKpi={onToggleSourceKpi}
                    onUpdateBinding={onUpdateSourceBinding}
                  />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">2 · Choose Ingestion Mode</p>
                  <p className="mt-1 text-xs text-gray-500">Manual, scheduled, webhook/realtime, or attestation.</p>
                  <div className="mt-3 grid gap-2">
                    {([
                      ['manual', 'Manual fetch'],
                      ['scheduled', 'Scheduled polling'],
                      ['realtime', 'Webhook / realtime'],
                      ['attestation', 'Manual attestation'],
                    ] as Array<[IngestionMode, string]>).map(([mode, label]) => {
                      const active = ingestionModeFor(selectedSource) === mode
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => onApplyIngestionMode(selectedSource, mode)}
                          disabled={isSavingSource}
                          className={`rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors ${active ? 'border-cs-primary bg-cs-primary text-white' : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-white'}`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  {ingestionModeFor(selectedSource) === 'scheduled' && (
                    <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Polling cadence
                      <select
                        value={selectedSource.schedule?.cadence || 'daily'}
                        onChange={(event) => onUpdateSource(selectedSource, { enabled: true, status: 'enabled', schedule: { ...(selectedSource.schedule || {}), cadence: event.target.value } })}
                        className="mt-1 h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700"
                      >
                        <option value="hourly">Hourly</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                      </select>
                    </label>
                  )}
                  {ingestionModeFor(selectedSource) === 'realtime' && (
                    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-xs leading-5 text-gray-600">
                      Webhook mode uses the authenticated source webhook endpoint and skips duplicate record IDs.
                    </div>
                  )}
                  {selectedSource.next_run_at && (
                    <p className="mt-3 text-xs text-gray-500">Next run: {formatDateTime(selectedSource.next_run_at)}</p>
                  )}
                </section>
              </div>

              <section className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">3 · Map Fields</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {selectedBindingKpi ? `Editing ${selectedBindingKpi.name}` : 'Select a KPI binding above to edit its fields.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedBinding && (
                      <Pill tone={selectedBindingHasOverrides ? 'blue' : 'emerald'}>
                        {selectedBindingHasOverrides ? 'Override' : 'Source defaults'}
                      </Pill>
                    )}
                    <Pill tone="emerald">{trackedKpis.length} tracked</Pill>
                  </div>
                </div>
                {selectedBinding ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-gray-950">{selectedBindingKpi?.name || selectedBinding.kpi_id}</p>
                        <p className="mt-0.5 text-[11px] text-gray-500">
                          {selectedBinding.enabled === false ? 'Disabled binding' : selectedBindingHasOverrides ? 'This KPI uses its own field mapping.' : 'This KPI currently inherits the source default mapping.'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={useSelectedBindingDefaults} disabled={isSavingSource || !selectedBindingHasOverrides}>
                          Use Defaults
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={overrideSelectedBinding} disabled={isSavingSource || selectedBinding.enabled === false}>
                          Override
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => updateSelectedBindingValue({ enabled: selectedBinding.enabled === false })}
                          disabled={isSavingSource}
                        >
                          {selectedBinding.enabled === false ? 'Enable' : 'Disable'}
                        </Button>
                      </div>
                    </div>
                    <KpiSourceFieldMapper
                      sourceConfigId={`${selectedSource.source_config_id}-${selectedBinding.binding_id || selectedBinding.kpi_id}`}
                      fieldMappings={selectedMapperMappings}
                      schemaFields={selectedSource.schema_fields}
                      samplePayload={selectedSource.sample_payload}
                      samplePayloadDraft={samplePayload}
                      recordPath={selectedSource.record_path}
                      trackedCount={trackedKpis.length}
                      isSaving={isSavingSource || selectedBinding.enabled === false}
                      onUpdateMapping={updateMapping}
                    />
                    <details className="rounded-md border border-gray-200 bg-white p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-gray-800">Edit source default mapping</summary>
                      <div className="mt-3">
                        <KpiSourceFieldMapper
                          sourceConfigId={`${selectedSource.source_config_id}-defaults`}
                          fieldMappings={selectedSource.field_mappings}
                          schemaFields={selectedSource.schema_fields}
                          samplePayload={selectedSource.sample_payload}
                          samplePayloadDraft={samplePayload}
                          recordPath={selectedSource.record_path}
                          trackedCount={trackedKpis.length}
                          isSaving={isSavingSource}
                          onUpdateMapping={updateSourceDefaultMapping}
                        />
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">No KPI binding selected.</div>
                )}
              </section>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">4 · Validate & Fetch</p>
                      <p className="mt-1 text-xs text-gray-500">Validate identity, actual value, timestamp, period, and record ID.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onSaveSample(selectedSource)}>Save</Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => onRunSourceAction(selectedSource, 'test')} disabled={isRunningSource}>
                        {isRunningSource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Validate
                      </Button>
                      <Button type="button" size="sm" className="h-7 gap-1.5 bg-cs-primary px-2 text-xs text-white hover:bg-cs-primary/90" onClick={() => onRunSourceAction(selectedSource, 'fetch')} disabled={isRunningSource}>
                        {isRunningSource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Fetch
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={samplePayload}
                    onChange={(event) => onSamplePayloadChange(event.target.value)}
                    placeholder="kpi_id,value,timestamp,period,record_id"
                    className="min-h-[180px] bg-white font-mono text-xs"
                  />
                  {(validationRows.length || skippedRows.length) ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <RunPreviewBlock title="Accepted Preview" rows={validationRows} empty="No accepted rows in latest validation." />
                      <RunPreviewBlock title="Skipped / Needs Fix" rows={skippedRows} empty="No skipped rows." />
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Latest Runs</p>
                  <div className="grid gap-2">
                    {selectedRuns.length ? selectedRuns.slice(0, 6).map((run) => (
                      <div key={run.run_id} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(run.status)}`}>{titleCase(run.status || 'run')}</span>
                          <span className="text-xs font-semibold text-gray-500">{run.records_accepted || 0}/{run.records_fetched || 0}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-gray-400">{runDisplayTime(run)} · {runDuration(run)}</p>
                      </div>
                    )) : (
                      <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-3 text-sm text-gray-400">No fetch runs yet.</div>
                    )}
                  </div>
                </div>
              </div>

              <details className="rounded-lg border border-gray-200 bg-white p-3">
                <summary className="cursor-pointer text-sm font-semibold text-gray-900">Advanced source, dedupe, and watermark fields</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Display name
                      <input
                        defaultValue={selectedSource.display_name}
                        onBlur={(event) => onUpdateSource(selectedSource, { display_name: event.target.value })}
                        className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2 text-sm text-gray-800"
                      />
                    </label>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Record path
                      <input
                        defaultValue={selectedSource.record_path || ''}
                        onBlur={(event) => onUpdateSource(selectedSource, { record_path: event.target.value })}
                        placeholder="records"
                        className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2 text-sm text-gray-800"
                      />
                    </label>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Dedupe key
                      <input
                        defaultValue={selectedSource.dedupe_key || 'record_id'}
                        onBlur={(event) => onUpdateSource(selectedSource, { dedupe_key: event.target.value })}
                        className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2 text-sm text-gray-800"
                      />
                    </label>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Watermark
                      <input
                        defaultValue={selectedSource.watermark_field || 'timestamp'}
                        onBlur={(event) => onUpdateSource(selectedSource, { watermark_field: event.target.value })}
                        className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2 text-sm text-gray-800"
                      />
                    </label>
                </div>
              </details>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[420px] items-center justify-center text-sm text-gray-500">
            Add a source to begin ingestion.
          </div>
        )}
      </section>
    </div>
  )
}

function FlagsPanel({
  breaches,
  kpiById,
  onFlagRemediationEmail,
}: {
  breaches: ContractKPIBreach[]
  kpiById: Map<string, ContractKPI>
  onFlagRemediationEmail: (breach: ContractKPIBreach) => Promise<ContractKPIBreach | null>
}) {
  const [expandedFlagId, setExpandedFlagId] = useState<string | null>(breaches.find((breach) => breach.is_breach)?.breach_id || null)
  const [alertDraft, setAlertDraft] = useState<{ to: string; subject: string; body: string; recipientSource?: ContractKPIBreach['breach_email_recipient_source'] } | null>(null)
  const ordered = [...breaches].sort((left, right) => {
    const severityRank: Record<string, number> = { Critical: 5, High: 4, Medium: 3, Low: 2, OK: 1 }
    return Number(right.is_breach) - Number(left.is_breach)
      || (severityRank[severityFor(right, kpiById.get(right.kpi_id))] || 0) - (severityRank[severityFor(left, kpiById.get(left.kpi_id))] || 0)
  })
  const openEscalation = async (breach: ContractKPIBreach, kpi?: ContractKPI) => {
    const updated = await onFlagRemediationEmail(breach)
    const source = updated || breach
    setAlertDraft({
      to: source.breach_email_to || kpi?.contact_email || '',
      subject: `[BREACH ALERT] ${kpi?.name || source.source_kpi?.name || source.kpi_id}`,
      body: source.breach_email_draft || buildEscalationDraft(source, kpi),
      recipientSource: source.breach_email_recipient_source,
    })
  }

  return (
    <>
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 p-4">
          <h2 className="text-base font-semibold text-gray-950">Compliance Flags</h2>
          <p className="mt-1 text-xs text-gray-500">Detailed breach records with threshold, source, remediation, and escalation actions.</p>
        </div>
        {!ordered.length ? (
          <div className="px-6 py-16 text-center text-sm text-gray-500">No compliance flags for tracked KPIs.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {ordered.map((breach) => {
              const kpi = kpiById.get(breach.kpi_id)
              const severity = severityFor(breach, kpi)
              const expected = expectedFor(breach, kpi)
              const actual = `${breach.actual_value ?? 'N/A'} ${breach.actual_unit || kpi?.unit || ''}`.trim()
              const expanded = expandedFlagId === breach.breach_id
              const exposure = Math.abs(toNumber(kpi?.consequence_value) || toNumber(breach.penalty_amount) || 0)
              return (
                <div key={breach.breach_id || `${breach.kpi_id}-${breach.created_at}`} className="bg-white">
                  <div className="grid gap-3 p-4 lg:grid-cols-[minmax(280px,1fr)_150px_130px_130px_170px] lg:items-center">
                    <button type="button" onClick={() => setExpandedFlagId(expanded ? null : breach.breach_id)} className="min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${breach.is_breach ? 'bg-cs-primary' : 'bg-gray-300'}`} />
                        <p className="truncate text-sm font-semibold text-gray-950">{kpi?.name || breach.source_kpi?.name || breach.kpi_id}</p>
                      </div>
                      <p className="mt-1 truncate pl-4 text-xs text-gray-400">{breach.kpi_id} · {formatDateTime(breach.created_at || breach.timestamp)}</p>
                    </button>
                    <div className={breach.is_breach ? 'text-sm font-semibold text-gray-950' : 'text-sm font-semibold text-gray-600'}>
                      {exposure ? `-${money(exposure)}` : 'No penalty'}
                    </div>
                    <span className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(breach.status || (breach.is_breach ? 'open' : 'clear'))}`}>{titleCase(breach.status || (breach.is_breach ? 'open' : 'clear'))}</span>
                    <span className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(severity)}`}>{severity}</span>
                    <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
                      <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setExpandedFlagId(expanded ? null : breach.breach_id)}>
                        Details
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </Button>
                      <Button type="button" size="sm" className="h-8 gap-1.5 bg-cs-primary text-xs text-white hover:bg-cs-primary/90" onClick={() => void openEscalation(breach, kpi)} disabled={!breach.is_breach}>
                        <Mail className="h-3.5 w-3.5" />
                        Escalate
                      </Button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="space-y-4 border-t border-gray-100 bg-gray-50 p-4">
                      <p className="text-sm leading-6 text-gray-700">
                        {breachNarrative(breach, kpi)}
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Expected (Contract)</p>
                          <p className="mt-1 text-sm font-semibold text-gray-950">{expected}</p>
                        </div>
                        <div className="rounded-lg border border-gray-300 bg-white p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Actual (Ingested)</p>
                          <p className="mt-1 text-sm font-semibold text-gray-950">{actual}</p>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <DetailTile label="Contract Clause" value={kpi?.structural_path || kpi?.section_path || kpi?.section || breach.source_kpi?.quote || 'Not captured'} tone="blue" />
                        <DetailTile label="Data Source" value={breach.source || 'Actual ingestion'} />
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Recommended Action</p>
                        <p className="mt-1 text-sm leading-6 text-gray-800">{breach.remediation || kpi?.remediation || 'Escalate to accountable party and request corrective action plan.'}</p>
                        <p className="mt-2 text-xs text-gray-500">SLA: {breach.remediation_sla || kpi?.remediation_sla || 'Not specified'} · Trigger: {breach.penalty_triggered || kpi?.trigger_condition || 'Not specified'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                          <Info className="h-3.5 w-3.5" />
                          Ask AI to Analyze
                        </Button>
                        <Button type="button" size="sm" className="h-8 gap-1.5 bg-cs-primary text-xs text-white hover:bg-cs-primary/90" onClick={() => void openEscalation(breach, kpi)} disabled={!breach.is_breach}>
                          <Send className="h-3.5 w-3.5" />
                          Send Escalation Alert Email
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {alertDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-base font-semibold text-gray-950">Escalation Alert Email</h3>
              <p className="mt-1 text-xs text-gray-500">Review the generated breach notice before dispatch.</p>
            </div>
            <div className="space-y-3 p-5">
              <DetailTile label="To" value={alertDraft.to || 'No contract email found'} tone={alertDraft.to ? 'gray' : 'amber'} />
              {alertDraft.recipientSource?.source && (
                <DetailTile label="Recipient Source" value={[
                  alertDraft.recipientSource.source,
                  alertDraft.recipientSource.matched_party ? `party: ${alertDraft.recipientSource.matched_party}` : '',
                  alertDraft.recipientSource.confidence ? `confidence: ${alertDraft.recipientSource.confidence}` : '',
                ].filter(Boolean).join(' · ')} />
              )}
              <DetailTile label="Subject" value={alertDraft.subject} />
              <Textarea value={alertDraft.body} onChange={(event) => setAlertDraft({ ...alertDraft, body: event.target.value })} className="min-h-[240px] font-mono text-xs" />
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <Button type="button" variant="ghost" onClick={() => setAlertDraft(null)}>Cancel</Button>
              <Button type="button" className="bg-cs-primary text-white hover:bg-cs-primary/90" disabled={!alertDraft.to} onClick={() => {
                toast({ title: 'Escalation alert dispatched', description: 'The breach alert has been marked for supplier follow-up.' })
                setAlertDraft(null)
              }}>
                Dispatch Alert
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function LogsPanel({
  actuals,
  kpiById,
  sourceConfigs,
  sourceRuns,
  runDetails,
  onLoadRunDetail,
}: {
  actuals: ContractKPIActual[]
  kpiById: Map<string, ContractKPI>
  sourceConfigs: KPISourceConfig[]
  sourceRuns: Record<string, KPISourceFetchRun[]>
  runDetails: Record<string, KPISourceRunDetail | { error: string }>
  onLoadRunDetail: (sourceConfigId: string, runId: string) => void | Promise<void>
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const sourceById = useMemo(() => new Map(sourceConfigs.map((source) => [source.source_config_id, source])), [sourceConfigs])
  const runs = useMemo(() => (
    sourceConfigs
      .flatMap((source) => (sourceRuns[source.source_config_id] || []).map((run) => ({
        ...run,
        source_config_id: run.source_config_id || source.source_config_id,
      })))
      .sort((left, right) => new Date(right.started_at || right.finished_at || 0).getTime() - new Date(left.started_at || left.finished_at || 0).getTime())
  ), [sourceConfigs, sourceRuns])
  const totalRecords = runs.reduce((total, run) => total + Number(run.records_fetched || 0), 0)
  const totalCreated = runs.reduce((total, run) => total + Number(run.created_actual_count || run.records_accepted || 0), 0)

  const toggleRun = (run: KPISourceFetchRun) => {
    const next = expandedRunId === run.run_id ? null : run.run_id
    setExpandedRunId(next)
    if (next) void onLoadRunDetail(run.source_config_id, run.run_id)
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-950">Performance Logs</h2>
          <p className="mt-1 text-xs text-gray-500">Source fetch runs, records accepted, duplicate skips, and generated compliance flags.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="blue">{runs.length} fetch runs</Pill>
          <Pill tone="emerald">{totalRecords} records fetched</Pill>
          <Pill tone="gray">{totalCreated} actuals created</Pill>
        </div>
      </div>
      {!runs.length ? (
        <div className="px-6 py-16 text-center text-sm text-gray-500">
          No source fetch runs yet.
          {actuals.length ? ` ${actuals.length} uploaded actual${actuals.length === 1 ? '' : 's'} exist outside the source ledger.` : ''}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {runs.map((run) => {
            const source = sourceById.get(run.source_config_id)
            const expanded = expandedRunId === run.run_id
            const detail = runDetails[run.run_id]
            const detailError = detail && 'error' in detail ? detail.error : null
            const runDetail = detail && !('error' in detail) ? detail : null
            const normalizedRows = runDetail?.normalized_rows || runDetail?.fetch_run?.normalized_preview || run.normalized_preview || []
            const skippedRows = runDetail?.skipped_rows || runDetail?.fetch_run?.skipped_rows || run.skipped_rows || []
            const createdActuals = runDetail?.created_actuals || []
            const createdBreaches = runDetail?.created_breaches || []
            const actualRows = createdActuals.map((actual) => {
              const kpi = kpiById.get(actual.kpi_id)
              return {
                actual_id: actual.actual_id,
                kpi: kpi?.name || actual.kpi_id,
                value: actualLabel(actual, kpi),
                timestamp: formatDateTime(actualTimestamp(actual)),
                period: actual.metadata?.period,
                record_id: actual.metadata?.source_record_id || actual.metadata?.source_dedupe_key || actual.metadata?.record_id,
              }
            })
            const breachRows = createdBreaches.map((breach) => {
              const kpi = kpiById.get(breach.kpi_id)
              return {
                breach_id: breach.breach_id,
                kpi: kpi?.name || breach.kpi_id,
                status: breach.is_breach ? 'flagged' : 'clear',
                severity: severityFor(breach, kpi),
                expected: expectedFor(breach, kpi),
                actual: `${breach.actual_value ?? 'N/A'} ${breach.actual_unit || kpi?.unit || ''}`.trim(),
              }
            })

            return (
              <div key={run.run_id} className="bg-white">
                <div className="grid gap-3 p-4 lg:grid-cols-[150px_minmax(220px,1fr)_minmax(240px,1.2fr)_120px_120px_90px] lg:items-center">
                  <div>
                    <p className="text-sm font-semibold text-gray-950">{runDisplayTime(run)}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{runDuration(run)} fetch time</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-950">{source?.display_name || run.source_config_id}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{titleCase(source?.source_type || run.source_type || 'source')} · {source ? ingestionModeLabel(source) : titleCase(run.trigger_type || 'manual')}</p>
                  </div>
                  <p className="min-w-0 truncate font-mono text-xs text-gray-500">{sourceEndpointLabel(source)}</p>
                  <span className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(run.status || 'completed')}`}>{titleCase(run.status || 'completed')}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-950">{run.records_fetched || 0} records</p>
                    <p className="mt-0.5 text-xs text-gray-400">{run.records_skipped || 0} skipped</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-8 justify-self-start text-xs text-gray-500 lg:justify-self-end" onClick={() => toggleRun(run)}>
                    Details
                    <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </Button>
                </div>

                {expanded && (
                  <div className="space-y-3 border-t border-gray-100 bg-gray-50 p-4">
                    <div className="grid gap-2 md:grid-cols-4">
                      <DetailTile label="Accepted Rows" value={`${run.records_accepted || createdActuals.length || 0}`} tone="blue" />
                      <DetailTile label="Created Actuals" value={`${run.created_actual_count ?? createdActuals.length}`} />
                      <DetailTile label="Generated Flags" value={`${run.created_breach_count ?? createdBreaches.length}`} tone={(run.created_breach_count || createdBreaches.length) ? 'amber' : 'gray'} />
                      <DetailTile label="Skipped Rows" value={`${run.records_skipped || skippedRows.length || 0}`} tone={(run.records_skipped || skippedRows.length) ? 'amber' : 'gray'} />
                    </div>

                    {detailError ? (
                      <div className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800">{detailError}</div>
                    ) : !detail ? (
                      <div className="flex items-center rounded-md border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading fetched records...
                      </div>
                    ) : (
                      <div className="grid gap-3 xl:grid-cols-2">
                        <RunPreviewBlock title="Created Actuals" rows={actualRows} empty="No actuals were created in this run." />
                        <RunPreviewBlock title="Skipped / Duplicate Rows" rows={skippedRows} empty="No skipped rows for this run." />
                        <RunPreviewBlock title="Accepted Normalized Rows" rows={normalizedRows} empty="No normalized rows were stored for this run." />
                        <RunPreviewBlock title="Generated Flags" rows={breachRows} empty="No compliance flags were generated in this run." />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
