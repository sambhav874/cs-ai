/**
 * GhostCompletion — P6.1 / docs/30 Wave G.1
 *
 * Copilot-style inline completion for the TipTap contract editor.
 *
 *   • 800ms debounce after last keystroke
 *   • POST /api/v1/agent/complete with last 1400 chars before cursor
 *     + next 400 chars after cursor (as style cue)
 *   • Renders the suggestion as a gray inline decoration at the cursor
 *     via ProseMirror decoration plugin
 *   • Tab accepts (inserts the text); Esc / any other key dismisses
 *   • In-flight fetches are aborted on new keystrokes
 *
 * Guardrails:
 *   • Only fires when the cursor is collapsed (no selection)
 *   • Only fires when ≥10 chars are present before the cursor
 *   • Only fires when the last char before cursor is a word-boundary
 *     (space, newline, punctuation) — we don't fight the user mid-word
 *   • Max 1 in-flight request; new debounce replaces the pending one
 *
 * Wire-up: add `GhostCompletion.configure({ contractType, enabled })`
 * to the editor's extensions array.
 */
import { Extension } from '@tiptap/react' // re-exported from @tiptap/core
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { api } from '@/lib/api'

export interface GhostCompletionOptions {
  contractType: string
  enabled:      boolean
  debounceMs:   number
}

const GhostKey = new PluginKey<{ suggestion: string; atPos: number; decos: DecorationSet }>('ghostCompletion')

interface CompletionResponse { completion?: string; reason?: string; error?: string }

export const GhostCompletion = Extension.create<GhostCompletionOptions>({
  name: 'ghostCompletion',

  addOptions() {
    return {
      contractType: 'general commercial',
      enabled:      true,
      debounceMs:   800,
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // Accept suggestion if one exists
        const state = this.editor.state
        const plug  = GhostKey.getState(state)
        if (!plug || !plug.suggestion) return false
        const { suggestion, atPos } = plug
        // Insert text at the tracked position, then clear the decoration.
        this.editor
          .chain()
          .insertContentAt(atPos, suggestion)
          .setMeta('ghostClear', true)
          .run()
        return true
      },
      Escape: () => {
        const plug = GhostKey.getState(this.editor.state)
        if (!plug || !plug.suggestion) return false
        this.editor.view.dispatch(this.editor.state.tr.setMeta('ghostClear', true))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    let timer: ReturnType<typeof setTimeout> | null = null
    let abort: AbortController | null = null

    // Last context fingerprint we asked about — avoid duplicate fetches.
    let lastKey = ''

    const fetchCompletion = async (view: import('@tiptap/pm/view').EditorView, contextBefore: string, contextAfter: string, atPos: number) => {
      try {
        abort?.abort()
        abort = new AbortController()
        const res = await api.post<CompletionResponse>(
          '/agent/complete',
          {
            contextBefore,
            contextAfter,
            contractType: opts.contractType,
            maxChars:     160,
          },
          { signal: abort.signal },
        )
        const out = (res.data.completion ?? '').trim()
        if (!out) return
        // Don't surface if the cursor has moved since we asked.
        const { selection } = view.state
        if (!selection.empty || selection.from !== atPos) return
        view.dispatch(view.state.tr.setMeta('ghostSuggest', { suggestion: out, atPos }))
      } catch (err) {
        // AbortErrors are expected when the user keeps typing — swallow.
        if ((err as Error)?.name === 'CanceledError' || (err as Error)?.name === 'AbortError') return
        // Other errors: silently give up; ghost-text is best-effort.
      }
    }

    return [
      new Plugin({
        key:   GhostKey,
        state: {
          init: () => ({ suggestion: '', atPos: 0, decos: DecorationSet.empty }),
          apply(tr, value, _old, newState) {
            // Hard clear on meta
            if (tr.getMeta('ghostClear')) {
              return { suggestion: '', atPos: 0, decos: DecorationSet.empty }
            }
            // Accept a new suggestion only if cursor is at the saved pos
            const suggest = tr.getMeta('ghostSuggest') as { suggestion: string; atPos: number } | undefined
            if (suggest) {
              const { selection } = newState
              if (selection.empty && selection.from === suggest.atPos) {
                const deco = Decoration.widget(
                  suggest.atPos,
                  () => {
                    const span = document.createElement('span')
                    span.className = 'ghost-text'
                    span.textContent = suggest.suggestion
                    span.setAttribute('data-testid', 'ghost-completion')
                    return span
                  },
                  { side: 1, ignoreSelection: true },
                )
                return {
                  suggestion: suggest.suggestion,
                  atPos:      suggest.atPos,
                  decos:      DecorationSet.create(newState.doc, [deco]),
                }
              }
            }
            // Any doc change or selection move → clear (user's already past it)
            if (tr.docChanged || tr.selectionSet) {
              if (value.suggestion) {
                return { suggestion: '', atPos: 0, decos: DecorationSet.empty }
              }
            }
            return value
          },
        },
        props: {
          decorations(state) { return this.getState(state)?.decos ?? DecorationSet.empty },
        },
        view(_view) {
          return {
            update(view, prev) {
              if (!opts.enabled) return
              // Debounced fetch on "paused after typing"
              const sel = view.state.selection
              if (!sel.empty) return
              if (view.state.doc === prev.doc && sel.from === prev.selection.from) return

              if (timer) clearTimeout(timer)
              timer = setTimeout(() => {
                const state = view.state
                if (!state.selection.empty) return
                const atPos = state.selection.from
                // Gather context window
                const full = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
                // Convert ProseMirror position → offset into full string.
                // textBetween doesn't emit the same offsets as positions, so
                // we approximate by rebuilding a prefix up to the cursor.
                const before = state.doc.textBetween(0, atPos, '\n', '\n')
                const after  = state.doc.textBetween(atPos, state.doc.content.size, '\n', '\n')

                if (before.length < 10) return
                const lastChar = before[before.length - 1]
                // Only trigger on word-boundary (space / newline / punct) — if
                // the user is mid-word, don't interrupt.
                if (!/[\s.;:,!?)"\]\-—]/.test(lastChar)) return

                const key = `${atPos}|${before.slice(-50)}`
                if (key === lastKey) return
                lastKey = key

                // Skip extremely large docs — protect the API token budget.
                if (full.length > 80_000) return

                fetchCompletion(view, before, after, atPos)
              }, opts.debounceMs)
            },
            destroy() {
              if (timer) clearTimeout(timer)
              abort?.abort()
            },
          }
        },
      }),
    ]
  },
})

export default GhostCompletion
