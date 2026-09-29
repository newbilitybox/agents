import { useEffect, useSyncExternalStore } from 'react'

const subscribeWindowFocus = (cb: () => void): (() => void) => {
  window.addEventListener('focus', cb)
  window.addEventListener('blur', cb)
  return () => {
    window.removeEventListener('focus', cb)
    window.removeEventListener('blur', cb)
  }
}

/**
 * done means a finished turn nobody has looked at yet. While `doneInView` — the
 * session is done and its view (the grid's active card, a pop-out) is up — in
 * the focused window, it counts as seen and main turns it idle. That covers the
 * click or notification that brings it up, coming back to the window, and a turn
 * that ends while being watched.
 */
export function useMarkSeen(sessionId: string, doneInView: boolean): void {
  const windowFocused = useSyncExternalStore(subscribeWindowFocus, () => document.hasFocus())
  useEffect(() => {
    if (doneInView && windowFocused) void window.api.markSessionSeen(sessionId)
  }, [sessionId, doneInView, windowFocused])
}
