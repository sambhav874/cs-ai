import { Fragment } from 'react'
import { Check, X, Minus } from 'lucide-react'
import type { CompareGroup, CompareVerdict } from '@/content/compare/types'

const Cell = ({ v }: { v: CompareVerdict }) => {
  if (v === 'yes')
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </span>
    )
  if (v === 'no')
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-50 text-rose-600">
        <X className="h-4 w-4" strokeWidth={2.5} />
      </span>
    )
  if (v === 'partial')
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-700">
        <Minus className="h-4 w-4" strokeWidth={2.5} />
      </span>
    )
  if (v === 'unknown')
    return <span className="font-mono text-xs text-slate-400">unknown</span>
  return <span className="font-mono text-xs font-medium text-slate-700">{v}</span>
}

export function ComparisonTable({
  groups,
  competitorName,
}: {
  groups: CompareGroup[]
  competitorName: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3 text-left">Capability</th>
            <th className="bg-emerald-50 px-5 py-3 text-center text-emerald-800">Draft Legal</th>
            <th className="px-5 py-3 text-center">{competitorName}</th>
            <th className="hidden px-5 py-3 text-left md:table-cell">Note</th>
          </tr>
        </thead>
        <tbody className="bg-white text-sm">
          {groups.map((g) => (
            <Fragment key={g.title}>
              <tr className="bg-slate-50">
                <td
                  colSpan={4}
                  className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {g.title}
                </td>
              </tr>
              {g.rows.map((r, i) => (
                <tr
                  key={`${g.title}-${i}`}
                  className="border-t border-slate-100"
                >
                  <td className="px-5 py-3.5 font-medium text-slate-800">{r.label}</td>
                  <td className="bg-emerald-50/60 px-5 py-3.5 text-center">
                    <Cell v={r.draftLegal} />
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <Cell v={r.competitor} />
                  </td>
                  <td className="hidden px-5 py-3.5 text-xs text-slate-500 md:table-cell">
                    {r.note ?? ''}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
