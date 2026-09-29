import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountUsage } from '@shared/types'
import { hasUsage, usageLines } from '@/lib/usage'

/** Re-render every `ms`: values computed from the clock (a reset or a limit
 *  park lapsing, "3 min ago") change without any state push to trigger one. */
export function useNow(ms = 30_000): void {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** An account's usage lines (see usageLines), kept current as time passes. */
export function useUsageLines(usage: AccountUsage | undefined): string[] | null {
  const { t } = useTranslation()
  useNow()
  if (!usage || !hasUsage(usage)) return null
  return usageLines(usage, { current: t('usage.current'), weekly: t('usage.weekly'), reset: t('account.reset') })
}

/** The usage lines one per row, or joined on one line (`inline`). */
export function UsageLines({ usage, inline = false }: { usage: AccountUsage; inline?: boolean }) {
  const lines = useUsageLines(usage)
  if (!lines) return null
  return inline ? <>{lines.join(' · ')}</> : lines.map((line) => <div key={line}>{line}</div>)
}
