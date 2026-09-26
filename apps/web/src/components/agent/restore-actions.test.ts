import { describe, expect, it } from 'vitest'
import { restoredActions, type SavedToolCall } from './restore-actions'

const proposal = (over: Partial<SavedToolCall> = {}): SavedToolCall => ({
  id: 'prop1', messageId: 'm1', toolName: 'contract_update', status: 'awaiting_confirmation', reversible: true,
  input: { contractId: 'c1', action: 'add_tag', tag: 'qa-test' },
  output: { preview: { summary: "Add tag 'qa-test' on this contract", contractId: 'c1abcdefghijklmn' }, source: 'lifecycle' },
  ...over,
})

describe('restoredActions', () => {
  it('brings back a pending Apply card after a reload', () => {
    const [card] = restoredActions([proposal()]).get('m1') ?? []
    expect(card).toMatchObject({
      id: 'prop1', proposalId: 'prop1', toolName: 'contract_update', status: 'awaiting_confirmation',
      summary: "Add tag 'qa-test' on this contract", target: 'Contract c1abcdefghij…', reversible: true,
      args: { contractId: 'c1', action: 'add_tag', tag: 'qa-test' },
    })
  })

  it('shows an applied proposal as applied, and as undone once rolled back', () => {
    const applied = proposal({ status: 'applied', output: { preview: { summary: 'Add tag' }, appliedToolCallId: 'run1' } })
    const run = { id: 'run1', messageId: 'm1', toolName: 'contract_update', status: 'success' }
    expect(restoredActions([applied, { ...run, createdAt: '2026-09-25T20:00:00Z' }]).get('m1')?.[0]).toMatchObject({
      status: 'applied', toolCallId: 'run1', appliedAt: Date.parse('2026-09-25T20:00:00Z'),   // gates the 15-min Undo
    })
    expect(restoredActions([applied, { ...run, rolledBackAt: '2026-09-25T20:00:00Z' }]).get('m1')?.[0].status).toBe('undone')
  })

  it('ignores ordinary tool calls', () => {
    expect(restoredActions([{ id: 't', messageId: 'm1', toolName: 'contract_search', status: 'success' }]).size).toBe(0)
  })
})
