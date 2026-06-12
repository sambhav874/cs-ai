export type KpiFieldRequirement = 'identity' | 'required' | 'optional'

export interface KpiSourceFieldDefinition {
  kpiField: string
  label: string
  placeholder: string
  transform: string
  requirement: KpiFieldRequirement
}

export interface KpiSourceFieldMapping {
  kpi_field?: string
  source_field?: string
  transform?: string
  [key: string]: any
}

export const KPI_SOURCE_FIELD_DEFINITIONS: KpiSourceFieldDefinition[] = [
  { kpiField: 'kpi_id', label: 'KPI ID', placeholder: 'kpi_id', transform: 'string', requirement: 'identity' },
  { kpiField: 'kpi_name', label: 'KPI Name', placeholder: 'kpi_name', transform: 'string', requirement: 'identity' },
  { kpiField: 'actual_value', label: 'Actual Value', placeholder: 'value', transform: 'number', requirement: 'required' },
  { kpiField: 'timestamp', label: 'Timestamp', placeholder: 'timestamp', transform: 'datetime', requirement: 'required' },
  { kpiField: 'unit', label: 'Unit', placeholder: 'unit', transform: 'string', requirement: 'optional' },
  { kpiField: 'period', label: 'Period', placeholder: 'period', transform: 'string', requirement: 'optional' },
  { kpiField: 'source_record_id', label: 'Record ID', placeholder: 'record_id', transform: 'string', requirement: 'required' },
]

export const REQUIRED_KPI_MAPPING_FIELDS = ['actual_value', 'timestamp', 'source_record_id']

const FALLBACK_SOURCE_FIELDS = [
  'kpi_id',
  'kpi_name',
  'value',
  'actual_value',
  'timestamp',
  'period',
  'unit',
  'record_id',
  'source_record_id',
]

export const getDefaultKpiSourceMappings = () => (
  KPI_SOURCE_FIELD_DEFINITIONS.map((definition) => ({
    kpi_field: definition.kpiField,
    source_field: definition.placeholder,
    transform: definition.transform,
  }))
)

const uniqueText = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>()
  const result: string[] = []
  values.forEach((value) => {
    const normalized = String(value || '').trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })
  return result
}

const splitDelimitedLine = (line: string, delimiter: string) => {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]
    if (character === '"' && quoted && nextCharacter === '"') {
      current += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === delimiter && !quoted) {
      parts.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }
  parts.push(current.trim())
  return parts
}

const fieldsFromDelimitedText = (value: string) => {
  const header = value.split(/\r?\n/).find((line) => line.trim())
  if (!header) return []
  const delimiters = [',', '\t', ';']
    .map((delimiter) => ({ delimiter, count: header.split(delimiter).length - 1 }))
    .sort((left, right) => right.count - left.count)
  const selectedDelimiter = delimiters[0]
  if (!selectedDelimiter || selectedDelimiter.count <= 0) return []
  return uniqueText(splitDelimitedLine(header, selectedDelimiter.delimiter))
}

const tryParseJson = (value: string) => {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const pathSegments = (path?: string | null) => (
  String(path || '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
)

const valueAtPath = (value: unknown, path?: string | null) => {
  const segments = pathSegments(path)
  if (!segments.length) return value
  let current: any = value
  for (const segment of segments) {
    if (current == null) return undefined
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
    } else if (typeof current === 'object') {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

const guessRecordRows = (value: unknown, depth = 0): unknown => {
  if (depth > 3 || value == null) return undefined
  if (Array.isArray(value)) return value
  if (typeof value !== 'object') return undefined

  const recordKeys = ['records', 'rows', 'data', 'items', 'results', 'actuals']
  const objectValue = value as Record<string, unknown>
  for (const key of recordKeys) {
    const nested = objectValue[key]
    if (Array.isArray(nested)) return nested
  }
  for (const key of recordKeys) {
    const nested = guessRecordRows(objectValue[key], depth + 1)
    if (nested !== undefined) return nested
  }
  return undefined
}

const flattenSourceFields = (value: unknown, prefix = '', depth = 0): string[] => {
  if (value == null || depth > 5) return []
  if (Array.isArray(value)) {
    return uniqueText(value.slice(0, 5).flatMap((item) => flattenSourceFields(item, prefix, depth + 1)))
  }
  if (typeof value !== 'object') return prefix ? [prefix] : []

  const fields: string[] = []
  Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
    const fieldPath = prefix ? `${prefix}.${key}` : key
    if (nestedValue == null || typeof nestedValue !== 'object') {
      fields.push(fieldPath)
      return
    }
    const nestedFields = flattenSourceFields(nestedValue, fieldPath, depth + 1)
    fields.push(...(nestedFields.length ? nestedFields : [fieldPath]))
  })
  return uniqueText(fields)
}

const fieldsFromPayload = (payload: unknown, recordPath?: string | null) => {
  if (payload == null || payload === '') return []
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed) return []
    const parsed = tryParseJson(trimmed)
    if (parsed !== undefined) return fieldsFromPayload(parsed, recordPath)
    return fieldsFromDelimitedText(trimmed)
  }

  const scopedPayload = recordPath ? valueAtPath(payload, recordPath) : guessRecordRows(payload)
  return uniqueText([
    ...flattenSourceFields(scopedPayload ?? payload),
    ...flattenSourceFields(payload),
  ])
}

const fieldsFromSchema = (schemaFields?: Array<Record<string, any>>) => (
  uniqueText((schemaFields || []).flatMap((field) => [
    field.name,
    field.field,
    field.field_name,
    field.key,
    field.path,
    field.source_field,
  ]))
)

export const detectKpiSourceFields = ({
  fieldMappings,
  recordPath,
  samplePayload,
  samplePayloadDraft,
  schemaFields,
}: {
  fieldMappings?: KpiSourceFieldMapping[]
  recordPath?: string | null
  samplePayload?: unknown
  samplePayloadDraft?: string
  schemaFields?: Array<Record<string, any>>
}) => {
  const mappedFields = (fieldMappings || []).map((mapping) => mapping.source_field)
  const activePayload = samplePayloadDraft?.trim() ? samplePayloadDraft : samplePayload
  return uniqueText([
    ...fieldsFromPayload(activePayload, recordPath),
    ...fieldsFromSchema(schemaFields),
    ...mappedFields,
    ...FALLBACK_SOURCE_FIELDS,
  ]).slice(0, 120)
}
