/**
 * Apply cards, from the live stream and from a saved thread.
 *
 * A proposal is saved with its turn as an `awaiting_confirmation` tool call;
 * Apply marks it `applied` with the id of the call that carried it out, and
 * Undo stamps that call's `rolledBackAt`. Rebuilding cards from those rows is
 * what lets a reloaded conversation still offer its pending Apply — before,
 * the card vanished on reload while the assistant's text still said "click
 * Apply", a dead end on both this platform and draftLegal.
 */
import type { PendingAction } from './ActionPreview'

/** A write the assistant proposed: the `tool_call_awaiting_confirmation` frame's fields. */
export function actionFromProposal(p: {
  id: string
  toolName: string
  args: Record<string, unknown>
  preview: Record<string, unknown> | null
  reversible: boolean
}): PendingAction {
  const preview = p.preview
  return {
    id: p.id,
    toolName: p.toolName,
    status: 'awaiting_confirmation',
    summary: String(preview?.summary ?? `Apply ${p.toolName}`),
    args: p.args,
    target: preview?.target ? String(preview.target)
      : preview?.title ? String(preview.title)
      : preview?.contractId ? `Contract ${String(preview.contractId).slice(0, 12)}…`
      : undefined,
    diff: Array.isArray(preview?.diff)
      ? preview.diff as Array<{ field: string; before: string | number | null; after: string | number | null }>
      : undefined,
    reversible: p.reversible,
    previewHtml: typeof preview?.html === 'string' ? preview.html : undefined,
    missingFields: Array.isArray(preview?.missingFields) ? (preview.missingFields as unknown[]).map(String) : undefined,
  }
}

export interface SavedToolCall {
  id: string
  messageId: string | null
  toolName: string
  input?: unknown
  status?: string
  output?: unknown
  reversible?: boolean
  rolledBackAt?: string | null
}

/** The Apply cards of a saved thread, by the assistant message that proposed them. */
export function restoredActions(toolCalls: SavedToolCall[]): Map<string, PendingAction[]> {
  const byId = new Map(toolCalls.map(tc => [tc.id, tc]))
  const out = new Map<string, PendingAction[]>()
  for (const tc of toolCalls) {
    if (!tc.messageId || (tc.status !== 'awaiting_confirmation' && tc.status !== 'applied')) continue
    const output = (tc.output && typeof tc.output === 'object') ? tc.output as Record<string, unknown> : {}
    const preview = (output.preview && typeof output.preview === 'object') ? output.preview as Record<string, unknown> : null
    const action = actionFromProposal({
      id: tc.id,
      toolName: tc.toolName,
      args: (tc.input && typeof tc.input === 'object') ? tc.input as Record<string, unknown> : {},
      preview,
      reversible: Boolean(tc.reversible),
    })
    action.proposalId = tc.id
    if (tc.status === 'applied') {
      const appliedId = typeof output.appliedToolCallId === 'string' ? output.appliedToolCallId : undefined
      action.toolCallId = appliedId
      action.status = appliedId && byId.get(appliedId)?.rolledBackAt ? 'undone' : 'applied'
    }
    out.set(tc.messageId, [...(out.get(tc.messageId) ?? []), action])
  }
  return out
}
