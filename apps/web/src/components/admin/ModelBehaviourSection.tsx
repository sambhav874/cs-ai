/**
 * Admin → AI → Model behaviour: how the org's AI calls run, as opposed to which
 * model they go to (Model routing, above). These are the intelligence tier's
 * team settings — the parser that turns an upload into text, temperature,
 * reasoning effort and the output limit — stored on the team that owns the
 * org's contracts, and read by extraction, Q&A and review on every call.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/common/Toaster'
import { apiJson, INTEL_API } from '@/features/intelligence/lib/apiClient'

interface Catalog {
  parsers: Array<{ id: string; label: string; description: string; configured: boolean }>
  default_parser: string
  reasoning_efforts: string[]
  temperature_range: [number, number]
  max_tokens_range: [number, number]
}
interface Saved {
  provider?: string
  models?: Record<string, string>
  parser?: string
  temperature?: number
  reasoning_effort?: string
  max_tokens?: number
}
type Draft = { parser: string; temperature: string; reasoning_effort: string; max_tokens: string }

async function intel<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiJson<T>(`${INTEL_API}${path}`, init)
  if (res.error) throw new Error(res.error)
  return res.data as T
}

const toDraft = (s: Saved): Draft => ({
  parser: s.parser ?? '',
  temperature: s.temperature != null ? String(s.temperature) : '',
  reasoning_effort: s.reasoning_effort ?? '',
  max_tokens: s.max_tokens != null ? String(s.max_tokens) : '',
})

const fieldCls = 'w-full text-[13px] rounded-md border border-input bg-card text-fg-950 px-2 py-1.5'

export function ModelBehaviourSection() {
  const qc = useQueryClient()
  const catalog = useQuery<Catalog>({ queryKey: ['intel-model-catalog'], queryFn: () => intel('/model-settings/catalog') })
  const saved = useQuery<{ settings: Saved }>({ queryKey: ['intel-model-settings'], queryFn: () => intel('/model-settings') })
  const [draft, setDraft] = useState<Draft>({ parser: '', temperature: '', reasoning_effort: '', max_tokens: '' })

  useEffect(() => { if (saved.data) setDraft(toDraft(saved.data.settings)) }, [saved.data])

  const [tMin, tMax] = catalog.data?.temperature_range ?? [0, 1]
  const [mMin, mMax] = catalog.data?.max_tokens_range ?? [256, 128000]
  const temp = draft.temperature === '' ? null : Number(draft.temperature)
  const maxTok = draft.max_tokens === '' ? null : Number(draft.max_tokens)
  const tempValid = temp === null || (!Number.isNaN(temp) && temp >= tMin && temp <= tMax)
  const maxValid = maxTok === null || (Number.isInteger(maxTok) && maxTok >= mMin && maxTok <= mMax)
  const isDirty = !!saved.data && JSON.stringify(toDraft(saved.data.settings)) !== JSON.stringify(draft)

  const save = useMutation({
    // The endpoint replaces the whole record, so the provider and model picks
    // saved there (not shown here — routing lives above) are sent back as-is.
    mutationFn: () => intel('/model-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: saved.data?.settings.provider,
        models: saved.data?.settings.models,
        parser: draft.parser || undefined,
        temperature: temp ?? undefined,
        reasoning_effort: draft.reasoning_effort || undefined,
        max_tokens: maxTok ?? undefined,
      }),
    }),
    onSuccess: () => {
      toast.success('Model behaviour saved')
      qc.invalidateQueries({ queryKey: ['intel-model-settings'] })
    },
    onError: (e: Error) => toast.error('Save failed', { description: e.message }),
  })

  const parserLabel = (id: string) => catalog.data?.parsers.find(p => p.id === id)?.label ?? id

  return (
    <section className="bg-card rounded-card border border-surface-200 p-5 space-y-4" data-testid="model-behaviour-section">
      <header>
        <h2 className="text-section text-fg-950 flex items-center gap-2">
          <FileText className="size-4 text-fg-700" />
          Model behaviour
        </h2>
        <p className="text-dense text-fg-500 mt-1">
          How uploads are read and how the models answer. Applies to extraction, Q&amp;A and playbook review.
          Leave a field on its default to use the server setting.
        </p>
      </header>

      {(catalog.isLoading || saved.isLoading) && <div className="text-dense text-fg-400">Loading…</div>}
      {(catalog.isError || saved.isError) && (
        <p role="alert" className="text-dense text-risk-700">
          Couldn't load these settings: {(catalog.error ?? saved.error)?.message}
        </p>
      )}

      {catalog.data && saved.data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-dense font-medium text-fg-800">Document parser</span>
            <select
              value={draft.parser}
              onChange={e => setDraft(d => ({ ...d, parser: e.target.value }))}
              className={fieldCls}
              data-testid="behaviour-parser"
            >
              <option value="">Default ({parserLabel(catalog.data.default_parser)})</option>
              {catalog.data.parsers.map(p => (
                <option key={p.id} value={p.id} disabled={!p.configured}>
                  {p.label}{p.configured ? '' : ' (not configured on this server)'}
                </option>
              ))}
            </select>
            <span className="block text-[12px] text-fg-500">
              {catalog.data.parsers.find(p => p.id === (draft.parser || catalog.data.default_parser))?.description}
            </span>
          </label>

          <label className="space-y-1">
            <span className="text-dense font-medium text-fg-800">Temperature</span>
            <input
              type="number" step="0.05" min={tMin} max={tMax} placeholder="Default"
              value={draft.temperature}
              onChange={e => setDraft(d => ({ ...d, temperature: e.target.value }))}
              className={fieldCls}
              aria-invalid={!tempValid}
              data-testid="behaviour-temperature"
            />
            <span className={`block text-[12px] ${tempValid ? 'text-fg-500' : 'text-risk-700'}`}>
              {tMin} to {tMax}. Lower is more literal, which suits extraction.
            </span>
          </label>

          <label className="space-y-1">
            <span className="text-dense font-medium text-fg-800">Reasoning effort</span>
            <select
              value={draft.reasoning_effort}
              onChange={e => setDraft(d => ({ ...d, reasoning_effort: e.target.value }))}
              className={fieldCls}
              data-testid="behaviour-reasoning"
            >
              <option value="">Default</option>
              {catalog.data.reasoning_efforts.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <span className="block text-[12px] text-fg-500">For models that support it. Higher is slower and costs more.</span>
          </label>

          <label className="space-y-1">
            <span className="text-dense font-medium text-fg-800">Output limit (tokens)</span>
            <input
              type="number" step="256" min={mMin} max={mMax} placeholder="Default"
              value={draft.max_tokens}
              onChange={e => setDraft(d => ({ ...d, max_tokens: e.target.value }))}
              className={fieldCls}
              aria-invalid={!maxValid}
              data-testid="behaviour-max-tokens"
            />
            <span className={`block text-[12px] ${maxValid ? 'text-fg-500' : 'text-risk-700'}`}>
              {mMin.toLocaleString()} to {mMax.toLocaleString()} per call.
            </span>
          </label>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-surface-200">
        {isDirty && (
          <Button variant="outline" onClick={() => saved.data && setDraft(toDraft(saved.data.settings))} disabled={save.isPending}>
            Discard
          </Button>
        )}
        <Button onClick={() => save.mutate()} disabled={!isDirty || !tempValid || !maxValid || save.isPending} className="gap-2">
          <Save className="size-4" />
          {save.isPending ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>
    </section>
  )
}
