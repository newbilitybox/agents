import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/stores/app'
import { cn } from '@/lib/utils'

/**
 * Auxiliary input for a session. Enter submits (except an IME's Enter that ends a
 * composition); Shift+Enter and Cmd+Enter insert a newline. A sent message stays
 * here, read-only, until main has typed it into claude, and turns editable again
 * if it was dropped on the way. Dropped/pasted files and pasted images are handled
 * window-wide in the preload (works from the terminal too) and land here as paths
 * via the store draft, which is keyed by session so it survives this input being
 * unmounted.
 */
export function ChatInput({ sessionId, autoFocus }: { sessionId: string; autoFocus?: boolean }) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const draft = useApp((s) => s.drafts[sessionId] ?? '')
  const setDraft = useApp((s) => s.setDraft)
  const sending = useApp((s) => !!s.sending[sessionId])
  const setSending = useApp((s) => s.setSending)
  const [error, setError] = useState<string | null>(null)
  const persistTimer = useRef<number | undefined>(undefined)

  // focus on activate, after xterm has mounted (which would otherwise grab focus)
  useEffect(() => {
    if (!autoFocus) return
    const id = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(id)
  }, [autoFocus])

  // persist the draft (debounced) so an app quit/restart can't eat typed text
  const persist = (text: string): void => {
    clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => void window.api.saveDraft(sessionId, text), 400)
  }

  const send = async (): Promise<void> => {
    const text = draft
    if (!text.trim() || sending) return
    setError(null)
    setSending(sessionId, true)
    try {
      await window.api.ptySubmit(sessionId, text)
      // only the sent text leaves — a path dropped in meanwhile stays
      const now = useApp.getState().drafts[sessionId] ?? ''
      const rest = now.startsWith(text) ? now.slice(text.length) : now
      setDraft(sessionId, rest)
      clearTimeout(persistTimer.current)
      void window.api.saveDraft(sessionId, rest)
    } catch (e) {
      setError(String(e))
    } finally {
      setSending(sessionId, false)
    }
  }

  return (
    <div className="bg-card rounded-lg border p-2 shadow-lg">
      {error && (
        <p className="text-destructive px-1 pb-1.5 text-xs" title={error}>
          {t('session.sendFailed')}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          autoFocus={autoFocus}
          value={draft}
          readOnly={sending}
          onChange={(e) => {
            setDraft(sessionId, e.target.value)
            persist(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            // an IME's Enter only commits its composition (e.g. the raw letters
            // typed in a Chinese IME) — Chromium reports it as key 'Enter'
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={t('session.inputPlaceholder')}
          rows={Math.min(6, draft.split('\n').length)}
          className={cn(
            'border-input focus-visible:ring-ring/50 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2',
            sending && 'opacity-60'
          )}
        />
        <Button size="icon" aria-label={t('session.send')} onClick={() => void send()} disabled={!draft.trim() || sending}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <CornerDownLeft />}
        </Button>
      </div>
    </div>
  )
}
