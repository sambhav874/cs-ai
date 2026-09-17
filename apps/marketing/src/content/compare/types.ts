export type CompareVerdict = 'yes' | 'no' | 'partial' | 'unknown' | string

export type CompareRow = {
  label: string
  draftLegal: CompareVerdict
  competitor: CompareVerdict
  note?: string
}

export type CompareGroup = {
  title: string
  rows: CompareRow[]
}

export type CompareData = {
  slug: string
  competitorName: string
  competitorOneLiner: string
  tldr: string
  pickDraftLegalIf: string[]
  pickCompetitorIf: string[]
  groups: CompareGroup[]
  migration: string
}
