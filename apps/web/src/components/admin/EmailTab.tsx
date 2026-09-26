/**
 * Admin → Organization → Email: is a provider configured, what the platform
 * tried to send (signing requests, share links, reminders, invites), and a
 * test send to your own address. Credentials live in the server environment
 * and never pass through here.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/primitives'
import { toast } from '@/components/common/Toaster'

interface Status { configured: boolean; via: 'sendgrid' | 'smtp' | null; host: string | null; port: number | null; from: string }
interface OutboxRow { id: string; kind: string; to: string; subject: string; status: 'sent' | 'failed' | 'not_configured'; via: string | null; error: string | null; createdAt: string }
interface Outbox { data: OutboxRow[]; last7Days: Record<string, number> }

const KINDS = ['signing', 'share', 'notification', 'invite', 'test'] as const
const KIND_LABEL: Record<string, string> = { signing: 'Signature request', share: 'Share link', notification: 'Reminder', invite: 'Invite', test: 'Test', other: 'Other' }
const STATUS_LABEL: Record<OutboxRow['status'], string> = { sent: 'Sent', failed: 'Failed', not_configured: 'Not sent: no provider' }
const STATUS_CLS: Record<OutboxRow['status'], string> = {
  sent: 'bg-success-50 text-success-700 border-success-200',
  failed: 'bg-risk-50 text-risk-700 border-risk-200',
  not_configured: 'bg-surface-100 text-fg-700 border-surface-200',
}
const thCls = 'text-left text-[11px] font-semibold text-fg-500 uppercase tracking-[0.08em] px-4 py-2'
const selectCls = 'text-[13px] rounded-md border border-input bg-card text-fg-950 px-2 py-1.5'

export function EmailTab() {
  const qc = useQueryClient()
  const [kind, setKind] = useState('')
  const status = useQuery<Status>({ queryKey: ['admin-email-status'], queryFn: () => api.get('/admin/email/status').then(r => r.data) })
  const outbox = useQuery<Outbox>({
    queryKey: ['admin-email-outbox', kind],
    queryFn: () => api.get(`/admin/email/outbox${kind ? `?kind=${kind}` : ''}`).then(r => r.data),
  })
  const test = useMutation({
    mutationFn: () => api.post('/admin/email/test', {}).then(r => r.data as { to: string; sent: boolean; reason?: string }),
    onSuccess: r => {
      if (r.sent) toast.success(`Test email sent to ${r.to}`)
      else toast.error('Test email not sent', { description: r.reason })
      qc.invalidateQueries({ queryKey: ['admin-email-outbox'] })
    },
    onError: (e: any) => toast.error('Test failed', { description: e?.response?.data?.detail ?? 'Unknown error' }),
  })

  const s = status.data
  const week = outbox.data?.last7Days ?? {}

  return (
    <div className="max-w-4xl space-y-6" data-testid="admin-email-tab">
      <div>
        <h1 className="text-title text-fg-950 flex items-center gap-2"><Mail className="size-5 text-fg-700" />Email</h1>
        <p className="text-dense text-fg-500 mt-1">
          Signature requests, share links, reminders and invites go out by email.
        </p>
      </div>

      <Card className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-section text-fg-950">Delivery</h2>
            {status.isLoading && <p className="text-dense text-fg-400 mt-1">Loading…</p>}
            {s && (s.configured ? (
              <p className="text-dense text-fg-700 mt-1" data-testid="email-status">
                Sending through <span className="font-medium">{s.via === 'sendgrid' ? 'SendGrid' : `SMTP (${s.host}:${s.port})`}</span> as{' '}
                <span className="font-mono text-[12px]">{s.from}</span>.
              </p>
            ) : (
              <p className="text-dense text-attention-700 mt-1" data-testid="email-status">
                No email provider is configured, so nothing is delivered. Signing and share links can still be
                copied from their dialogs. To send, set <span className="font-mono text-[12px]">SENDGRID_API_KEY</span>, or{' '}
                <span className="font-mono text-[12px]">SMTP_HOST</span> with its port and login, in the server environment and redeploy.
              </p>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending} data-testid="email-test-btn">
            <Send />
            {test.isPending ? 'Sending…' : 'Send test email'}
          </Button>
        </div>
        <p className="text-[12px] text-fg-500 tabular-nums">
          Last 7 days: {week.sent ?? 0} sent · {week.failed ?? 0} failed · {week.not_configured ?? 0} not sent (no provider)
        </p>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-section text-fg-950">Outbox</h2>
          <select aria-label="Kind" value={kind} onChange={e => setKind(e.target.value)} className={selectCls}>
            <option value="">All emails</option>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        {outbox.isLoading ? (
          <p className="text-dense text-fg-400">Loading…</p>
        ) : !outbox.data?.data.length ? (
          <EmptyState icon={<Mail />} title="Nothing sent yet" description="Emails appear here as the platform sends them." />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full" data-testid="email-outbox">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50">
                  <th className={thCls}>When</th>
                  <th className={thCls}>Kind</th>
                  <th className={thCls}>To</th>
                  <th className={thCls}>Subject</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200">
                {outbox.data.data.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-[13px] text-fg-700 tabular-nums whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2 text-[13px] text-fg-700">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="px-4 py-2 text-[13px] text-fg-950">{r.to}</td>
                    <td className="px-4 py-2 text-[13px] text-fg-700 max-w-xs truncate" title={r.subject}>{r.subject}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block rounded-chip border px-1.5 py-0.5 text-[11px] ${STATUS_CLS[r.status]}`} title={r.error ?? undefined}>
                        {STATUS_LABEL[r.status]}{r.status === 'sent' && r.via ? ` · ${r.via}` : ''}
                      </span>
                      {r.status === 'failed' && r.error && <p className="text-[11px] text-risk-700 mt-0.5 max-w-xs truncate" title={r.error}>{r.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}
