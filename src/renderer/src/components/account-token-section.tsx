import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardPaste, Copy, Eye, EyeOff, KeyRound } from 'lucide-react'
import type { Account, AccountTokenInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useApp } from '@/stores/app'
import { AccountLoginDialog } from '@/components/account-login-dialog'

/** `<input type="date">` value → epoch ms at the end of that local day (a token
 *  dated "Oct 1" still works on Oct 1); null when left empty */
export const endOfDay = (date: string): number | null => (date ? new Date(`${date}T23:59:59`).getTime() : null)

/** When a token stops working: its date and the days left, or that nobody knows. */
export function TokenExpiry({ token }: { token: AccountTokenInfo }) {
  const { t, i18n } = useTranslation()
  if (token.expiresAt == null) return <>{t('account.tokenExpiryUnknown')}</>
  const date = new Date(token.expiresAt).toLocaleDateString(i18n.language)
  const days = Math.floor((token.expiresAt - Date.now()) / 86_400_000)
  if (token.expiresAt <= Date.now()) return <span className="text-destructive">{t('account.tokenExpiredOn', { date })}</span>
  return <>{t('account.tokenExpiresOn', { date, days })}</>
}

/**
 * An account's long-lived token (`claude setup-token`): look at it, copy it,
 * generate a new one, or paste one made elsewhere. A login account only keeps
 * it for the user; a token account runs on it. The value is fetched from main
 * when asked for — the app state only carries its last characters and dates.
 */
export function AccountTokenSection({ account }: { account: Account }) {
  const { t } = useTranslation()
  const token = useApp((s) => s.accounts.find((a) => a.configDir === account.configDir)?.token ?? null)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [expiry, setExpiry] = useState('')
  const [error, setError] = useState('')

  // a new token replaced the one on show
  useEffect(() => setRevealed(null), [token?.hint, token?.createdAt])

  const toggle = async (): Promise<void> => setRevealed(revealed ? null : await window.api.revealAccountToken(account.configDir))

  const copy = async (): Promise<void> => {
    const value = await window.api.revealAccountToken(account.configDir)
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const savePasted = async (): Promise<void> => {
    setError('')
    try {
      await window.api.setAccountToken(account.configDir, pasted, endOfDay(expiry))
      setPasting(false)
      setPasted('')
      setExpiry('')
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="grid gap-2">
      <Label>{t('account.token')}</Label>
      {token ? (
        <>
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label={t('account.token')}
              value={revealed ?? `••••••••${token.hint}`}
              className="text-muted-foreground font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button variant="outline" size="icon" aria-label={t(revealed ? 'account.tokenHide' : 'account.tokenShow')} onClick={() => void toggle()}>
              {revealed ? <EyeOff /> : <Eye />}
            </Button>
            <Button variant="outline" size="icon" aria-label={t(copied ? 'common.copied' : 'common.copy')} onClick={() => void copy()}>
              <Copy className={copied ? 'text-emerald-500' : ''} />
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            <TokenExpiry token={token} />
          </p>
        </>
      ) : (
        <p className="text-muted-foreground text-xs">{t('account.tokenNone')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setGenerating(true)}>
          <KeyRound /> {t(token ? 'account.tokenRegenerate' : 'account.tokenGenerate')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPasting((v) => !v)}>
          <ClipboardPaste /> {t('account.tokenPaste')}
        </Button>
      </div>
      {pasting && (
        <div className="grid gap-2 rounded-md border p-3">
          <Input
            type="password"
            aria-label={t('account.tokenField')}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={t('account.tokenPlaceholder')}
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="token-expiry" className="shrink-0">
              {t('account.tokenExpiry')}
            </Label>
            <Input id="token-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            <Button size="sm" disabled={!pasted.trim()} onClick={() => void savePasted()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <p className="text-muted-foreground text-xs">{t(account.auth === 'token' ? 'account.tokenAuthHint' : 'account.tokenVaultHint')}</p>
      {generating && <AccountLoginDialog account={account} purpose="token" onClose={() => setGenerating(false)} />}
    </div>
  )
}
