import React, { useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckCircle2 } from 'lucide-react'
import { Button } from '@cs/components/ui/button'
import {
  detectKpiSourceFields,
  KPI_SOURCE_FIELD_DEFINITIONS,
  REQUIRED_KPI_MAPPING_FIELDS,
} from '@cs/lib/kpi-source-fields'
import type { KpiSourceFieldMapping } from '@cs/lib/kpi-source-fields'

interface KpiSourceFieldMapperProps {
  sourceConfigId: string
  fieldMappings?: KpiSourceFieldMapping[]
  schemaFields?: Array<Record<string, any>>
  samplePayload?: unknown
  samplePayloadDraft?: string
  recordPath?: string | null
  trackedCount?: number
  isSaving?: boolean
  onUpdateMapping: (kpiField: string, sourceField: string, transform?: string) => void | Promise<void>
  onMapTrackedKpis?: () => void | Promise<void>
}

const requirementLabel = (requirement: string) => {
  if (requirement === 'identity') return 'Identity'
  if (requirement === 'required') return 'Required'
  return 'Optional'
}

const requirementTone = (requirement: string) => {
  if (requirement === 'identity') return 'border-surface-300 bg-card text-fg-950'
  if (requirement === 'required') return 'border-surface-300 bg-card text-fg-950'
  return 'border-surface-200 bg-surface-50 text-fg-700'
}

export default function KpiSourceFieldMapper({
  sourceConfigId,
  fieldMappings = [],
  schemaFields,
  samplePayload,
  samplePayloadDraft,
  recordPath,
  trackedCount = 0,
  isSaving = false,
  onUpdateMapping,
  onMapTrackedKpis,
}: KpiSourceFieldMapperProps) {
  const [selectedSourceField, setSelectedSourceField] = useState('')
  const sourceFieldOptions = useMemo(() => (
    detectKpiSourceFields({
      fieldMappings,
      recordPath,
      samplePayload,
      samplePayloadDraft,
      schemaFields,
    })
  ), [fieldMappings, recordPath, samplePayload, samplePayloadDraft, schemaFields])
  const mappingByKpiField = useMemo(() => {
    const mappings = new Map<string, KpiSourceFieldMapping>()
    fieldMappings.forEach((mapping) => {
      if (mapping.kpi_field) mappings.set(String(mapping.kpi_field), mapping)
    })
    return mappings
  }, [fieldMappings])
  const mappedSourceFields = useMemo(() => (
    new Set(fieldMappings.map((mapping) => String(mapping.source_field || '')).filter(Boolean))
  ), [fieldMappings])
  const hasIdentityMapping = Boolean(
    mappingByKpiField.get('kpi_id')?.source_field || mappingByKpiField.get('kpi_name')?.source_field
  )
  const requiredMappedCount = REQUIRED_KPI_MAPPING_FIELDS.filter((field) => (
    Boolean(mappingByKpiField.get(field)?.source_field)
  )).length + (hasIdentityMapping ? 1 : 0)
  const requiredFieldCount = REQUIRED_KPI_MAPPING_FIELDS.length + 1

  useEffect(() => {
    if (selectedSourceField && !sourceFieldOptions.includes(selectedSourceField)) {
      setSelectedSourceField('')
    }
  }, [selectedSourceField, sourceFieldOptions])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
          <span className={`rounded-full border px-2 py-1 ${requiredMappedCount === requiredFieldCount ? 'border-surface-300 bg-card text-fg-950' : 'border-surface-200 bg-surface-50 text-fg-700'}`}>
            {requiredMappedCount}/{requiredFieldCount} required
          </span>
          <span className="rounded-full border border-surface-200 bg-surface-50 px-2 py-1 text-fg-700">{sourceFieldOptions.length} fields</span>
        </div>
        {onMapTrackedKpis && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onMapTrackedKpis}
            disabled={isSaving || trackedCount === 0}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Map Tracked KPIs
          </Button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.72fr)_minmax(0,1.28fr)]">
        <section className="min-w-0 rounded-md border border-surface-200 bg-surface-50 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-fg-400">Source Fields</p>
            <span className="truncate text-[11px] font-semibold text-fg-500">
              {selectedSourceField || 'None selected'}
            </span>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {sourceFieldOptions.map((fieldName) => {
              const selected = selectedSourceField === fieldName
              const mapped = mappedSourceFields.has(fieldName)
              return (
                <button
                  key={fieldName}
                  type="button"
                  title={fieldName}
                  onClick={() => setSelectedSourceField(fieldName)}
                  className={`flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border px-2 text-left transition-colors ${
                    selected
                      ? 'border-primary-700 bg-card text-fg-950'
                      : mapped
                        ? 'border-surface-300 bg-card text-fg-950'
                        : 'border-transparent bg-card/70 text-fg-700 hover:border-surface-200 hover:bg-card'
                  }`}
                >
                  <span className="truncate font-mono text-[11px]">{fieldName}</span>
                  {mapped && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-fg-700" />}
                </button>
              )
            })}
          </div>
        </section>

        <section className="min-w-0 rounded-md border border-surface-200 bg-card">
          <div className="hidden grid-cols-[minmax(120px,0.75fr)_minmax(150px,1fr)_94px_76px] gap-2 border-b border-surface-100 px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-fg-400 md:grid">
            <span>KPI Field</span>
            <span>Source Field</span>
            <span>Transform</span>
            <span>Match</span>
          </div>
          <div className="divide-y divide-surface-100">
            {KPI_SOURCE_FIELD_DEFINITIONS.map((definition) => {
              const mapping = mappingByKpiField.get(definition.kpiField)
              const mappedSourceField = String(mapping?.source_field || '')
              const mappedTransform = String(mapping?.transform || definition.transform)
              const inputListId = `${sourceConfigId}-${definition.kpiField}-source-fields`
              return (
                <div key={definition.kpiField} className="grid gap-2 px-2 py-2 md:grid-cols-[minmax(120px,0.75fr)_minmax(150px,1fr)_94px_76px] md:items-center">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-fg-950">{definition.label}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${requirementTone(definition.requirement)}`}>
                        {requirementLabel(definition.requirement)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-fg-400">{definition.kpiField}</p>
                  </div>
                  <div className="min-w-0">
                    <input
                      key={`${sourceConfigId}-${definition.kpiField}-${mappedSourceField}`}
                      list={inputListId}
                      defaultValue={mappedSourceField}
                      onBlur={(event) => onUpdateMapping(definition.kpiField, event.target.value, mappedTransform)}
                      placeholder={definition.placeholder}
                      className="h-8 w-full min-w-0 rounded-md border border-surface-200 bg-surface-50 px-2 font-mono text-xs font-semibold text-fg-950"
                    />
                    <datalist id={inputListId}>
                      {sourceFieldOptions.map((fieldName) => (
                        <option key={fieldName} value={fieldName} />
                      ))}
                    </datalist>
                  </div>
                  <select
                    value={mappedTransform}
                    onChange={(event) => onUpdateMapping(definition.kpiField, mappedSourceField || definition.placeholder, event.target.value)}
                    className="h-8 rounded-md border border-surface-200 bg-card px-2 text-xs font-semibold text-fg-700"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="datetime">Date</option>
                    <option value="boolean">Bool</option>
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-[11px]"
                    disabled={isSaving || !selectedSourceField}
                    title={selectedSourceField ? `Use ${selectedSourceField}` : 'Select a source field'}
                    onClick={() => onUpdateMapping(definition.kpiField, selectedSourceField, mappedTransform)}
                  >
                    Use
                  </Button>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
