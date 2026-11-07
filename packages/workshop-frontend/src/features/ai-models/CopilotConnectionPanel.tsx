import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, CopilotConnectionStart } from '@gadgets/workshop-shared/api'
import { useI18n } from '../../i18n'

export const CopilotConnectionPanel = ({ api, account, canConnect, onChange }: {
  api: RpcStub<AuthenticatedApi>
  account: {login?: string} | null
  canConnect: boolean
  onChange: () => void
}) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [start, setStart] = useState<CopilotConnectionStart | null>(null)
  // The in-flight sign-in lives in refs, so an unmounted panel stops polling it.
  const polling = useRef(false)

  useEffect(() => () => { polling.current = false }, [])

  const begin = async () => {
    setBusy(true)
    setError('')
    try {
      const started = await api.startCopilotConnection()
      setStart(started)
      polling.current = true
      void poll()
    } catch {
      setError(t('Copilot sign-in could not start. Try again.'))
    } finally { setBusy(false) }
  }

  const poll = async () => {
    // GitHub's device flow asks callers to wait between polls; the interval is five seconds.
    for (let attempt = 0; polling.current && attempt < 240; attempt++) {
      await new Promise(done => setTimeout(done, 5000))
      if (!polling.current) return
      try {
        if (await api.completeCopilotConnection()) {
          polling.current = false
          setStart(null)
          setOpen(false)
          onChange()
          return
        }
      } catch (failure) {
        polling.current = false
        setStart(null)
        setError(failure instanceof Error && failure.message
          ? failure.message : t('Copilot sign-in ended without completing. Start it again.'))
        return
      }
    }
    if (polling.current) {
      polling.current = false
      setStart(null)
      setError(t('Copilot sign-in timed out. Start it again.'))
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError('')
    try { await api.disconnectCopilot(); onChange() }
    catch { setError(t('Failed to disconnect GitHub Copilot.')) }
    finally { setBusy(false) }
  }

  const cancel = () => {
    polling.current = false
    setStart(null)
    setOpen(false)
  }

  return (
    <section aria-label="GitHub Copilot" className="my-4 rounded-xl border border-kumo-line bg-kumo-base p-4">
      <h2 className="font-medium text-kumo-default">GitHub Copilot</h2>
      <p className="my-2 text-sm text-kumo-subtle">
        {account?.login
          ? t('GitHub Copilot is connected', { login: account.login })
          : start
            ? t('Waiting for GitHub authorization…')
            : t('Connect your Copilot plan to use its models in chat.')}
      </p>
      <div className="flex gap-2">
        {canConnect && <Button disabled={busy || !!start} onClick={() => { void begin() }}>
          Continue with GitHub
        </Button>}
        {account?.login && <Button variant="secondary" disabled={busy} onClick={disconnect}>
          {t('Disconnect Copilot')}
        </Button>}
      </div>
      {error && !open && <p role="alert" className="mt-2 text-sm text-kumo-danger">{error}</p>}
      <Dialog.Root open={open || !!start} onOpenChange={value => { if (!value) cancel() }}>
        <Dialog className="p-6" size="lg">
          <Dialog.Title>Continue with GitHub</Dialog.Title>
          {start ? (
            <>
              <Dialog.Description className="mt-2 text-sm text-kumo-subtle">
                {t('Open the GitHub page, enter the code, and approve Copilot for this account.')}
              </Dialog.Description>
              <p className="my-4 text-2xl font-semibold tracking-[0.3em] text-kumo-default">
                {start.userCode}
              </p>
              <p className="text-sm text-kumo-default">
                <a className="text-kumo-brand underline" href={start.verificationUri}
                  target="_blank" rel="noreferrer">{start.verificationUri}</a>
              </p>
              <p className="mt-4 text-sm text-kumo-subtle">{t('Waiting for GitHub authorization…')}</p>
              {error && <p role="alert" className="mt-2 text-sm text-kumo-danger">{error}</p>}
              <Button className="mt-4" variant="secondary" onClick={cancel}>{t('Cancel')}</Button>
            </>
          ) : (
            <Button className="mt-4" disabled={busy} onClick={() => { void begin() }}>
              Continue with GitHub
            </Button>
          )}
        </Dialog>
      </Dialog.Root>
    </section>
  )
}
