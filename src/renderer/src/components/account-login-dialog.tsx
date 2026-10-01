import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, Loader2, RotateCw } from 'lucide-react'
import type { Account } from '@shared/types'
import type { LoginLinks, LoginPurpose } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SessionBody } from '@/components/session-body'
import { useApp } from '@/stores/app'

/**
 * OAuth sign-in for one account — three ways in, all off the one `claude auth
 * login` process: open the browser-callback link (finishes by itself on this
 * machine), copy the plain link anywhere and paste the code back, or just use
 * the CLI's own prompt in the embedded terminal. Closing the dialog aborts the
 * sign-in; it closes itself once the account reads as logged in.
 *
 * With purpose "token" the same sign-in runs `claude setup-token` instead and
 * the dialog closes once the account's new token is stored. That one has no
 * terminal: its screen ends by showing the token, and must stay wide enough
 * not to wrap it.
 */
export function AccountLoginDialog({ account, purpose = 'login', onClose }: { account: Account; purpose?: LoginPurpose; onClose: () => void }) {
  const { t } = useTranslation()
  const forToken = purpose === 'token'
  const [links, setLinks] = useState<LoginLinks | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const live = useApp((s) => s.accounts.find((a) => a.configDir === account.configDir))
  // the token the account had when the dialog opened: a different one is the new one
  const [tokenAtOpen] = useState(() => live?.token ?? null)
  const done = forToken
    ? !!live?.token && (live.token.hint !== tokenAtOpen?.hint || live.token.createdAt !== tokenAtOpen?.createdAt)
    : live?.loginStatus === 'logged_in'
  // the sign-in process ended without a result (a failed browser/terminal
  // attempt, or it died): its links are dead — show its last word and offer a fresh start
  const ended = !!links && live?.loginActive === false && !done
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setLinks(null)
    setMessage('')
    window.api
      .startLogin(account.configDir, purpose)
      .then((l) => alive && setLinks(l))
      .catch((e) => alive && setMessage(String(e)))
    return () => {
      alive = false
      void window.api.cancelLogin(account.configDir)
    }
  }, [account.configDir, purpose, attempt])

  useEffect(() => {
    if (done) onClose()
  }, [done, onClose])

  const submit = async (): Promise<void> => {
    if (!code.trim()) return
    setSubmitting(true)
    setMessage('')
    try {
      const r = await window.api.submitLoginCode(account.configDir, code)
      if (r.ok) onClose()
      else if (!forToken) setMessage(r.message ?? t('account.loginFailed')) // the CLI's own words when it gave any
      // a failed token sign-in has ended its process: the `ended` banner carries its words
    } catch (e) {
      setMessage(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const copy = (): void => {
    if (!links) return
    void navigator.clipboard.writeText(links.manualUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t(forToken ? 'account.tokenGenerate' : 'account.login')} · {account.name}
          </DialogTitle>
        </DialogHeader>

        {!links && !message && (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" /> {t('account.loginStarting')}
          </div>
        )}

        {links && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <p className="text-muted-foreground text-sm">{t(forToken ? 'account.tokenLoginHint' : 'account.loginBrowserHint')}</p>
              {/* window.open → main's setWindowOpenHandler → the system browser */}
              <Button className="w-fit" disabled={!links.browserUrl} onClick={() => window.open(links.browserUrl!, '_blank')}>
                <ExternalLink /> {t('account.loginBrowser')}
              </Button>
            </div>
            <div className="grid gap-2">
              <p className="text-muted-foreground text-sm">{t('account.loginUrlHint')}</p>
              <div className="flex gap-2">
                <Input readOnly value={links.manualUrl} className="text-muted-foreground text-xs" onFocus={(e) => e.target.select()} />
                <Button variant="outline" size="icon" aria-label={t(copied ? 'common.copied' : 'common.copy')} onClick={copy}>
                  <Copy className={copied ? 'text-emerald-500' : ''} />
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  id="login-code"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void submit()}
                  placeholder={t('account.loginCodePlaceholder')}
                />
                <Button onClick={() => void submit()} disabled={!code.trim() || submitting}>
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : t('common.submit')}
                </Button>
              </div>
            </div>
            {ended && (
              <div className="bg-destructive/10 text-destructive flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{live?.loginVerdict || t(forToken ? 'account.tokenEnded' : 'account.loginEnded')}</span>
                <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                  <RotateCw /> {t('account.loginRetry')}
                </Button>
              </div>
            )}
            {!forToken && (
              <div className="grid gap-2">
                <Label>{t('account.loginTerminalHint')}</Label>
                {/* the login pty itself — typing here is typing into `claude auth login` */}
                <div className="flex h-52 flex-col overflow-hidden rounded-md border">
                  <SessionBody sessionId={links.ptyId} active fontSize={11} />
                </div>
              </div>
            )}
          </div>
        )}

        {message && <p className="text-destructive text-sm">{message}</p>}
      </DialogContent>
    </Dialog>
  )
}
