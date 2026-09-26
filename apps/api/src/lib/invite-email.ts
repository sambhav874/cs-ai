/**
 * Invite email — the link a new colleague follows to set their password.
 *
 * Invites were created with a token and returned to the admin's screen to copy;
 * nothing emailed them. The link is still logged and still returned, so an
 * install with no mail provider can hand it over by hand.
 */
import { sendEmail } from './mailer.js'

interface SendInviteEmailArgs {
  orgId: string
  to: string
  inviteeName: string
  inviterName: string | null
  orgName: string
  token: string
  expiresAt: Date
}

export function inviteUrl(token: string): string {
  const base = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '')
  return `${base}/accept-invite/${token}`
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function sendInviteEmail(args: SendInviteEmailArgs): void {
  const url = inviteUrl(args.token)
  const expires = args.expiresAt.toISOString().slice(0, 10)
  const who = args.inviterName ?? args.orgName
  console.info(`[invite] ✉  ${args.to}  →  ${url}  (expires ${expires})`)

  const text = [
    `Hi ${args.inviteeName},`,
    '',
    `${who} has invited you to ${args.orgName} on the contract platform.`,
    '',
    'Set your password and sign in here:',
    url,
    '',
    `This invitation expires on ${expires}.`,
    `If you weren't expecting it, you can ignore this email.`,
  ].join('\n')

  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;margin:0;padding:24px;color:#1f2937">
    <div style="max-width:560px;margin:0 auto;background:white;padding:32px 28px;border-radius:12px">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 12px 0;color:#111827">You're invited to ${escape(args.orgName)}</h1>
      <p style="font-size:15px;line-height:1.55;margin:0">Hi ${escape(args.inviteeName)},<br/><br/>
      ${escape(who)} has invited you to join <strong>${escape(args.orgName)}</strong>.</p>
      <p style="margin:24px 0">
        <a href="${url}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px;font-size:15px">Accept the invitation &rarr;</a>
      </p>
      <p style="color:#9ca3af;font-size:12px;margin:18px 0 0 0">If the button doesn't work, paste this URL into your browser:<br/>
        <span style="word-break:break-all">${url}</span></p>
      <p style="color:#888;font-size:12px;margin-top:24px">This invitation expires on ${expires}.</p>
    </div>
  </body></html>`

  sendEmail({ orgId: args.orgId, kind: 'invite', to: args.to, subject: `You're invited to ${args.orgName}`, text, html })
    .then((r) => { if (!r.sent) console.warn(`[invite] email not sent to ${args.to}: ${r.reason}`) })
    .catch((err) => console.warn(`[invite] email send error for ${args.to}: ${(err as Error).message}`))
}
