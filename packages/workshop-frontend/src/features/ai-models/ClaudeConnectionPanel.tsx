import { useState } from 'react'
import { Button, Dialog } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import { useI18n } from '../../i18n'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'

/** The local credential file the sign-in helper writes; importing it here connects the account. */
export const ClaudeConnectionPanel = ({ api, account, canConnect, onChange }: {
  api: RpcStub<AuthenticatedApi>
  account: {email?: string} | null
  canConnect: boolean
  onChange: () => void
}) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const importFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 65536) { setError(t('The credential file is too large.')); return }
    setBusy(true)
    setError('')
    try {
      await api.importClaude(await file.text())
      setOpen(false)
      onChange()
    } catch {
      setError(t('Claude connection failed. Run the sign-in helper again and import the new file.'))
    } finally { setBusy(false) }
  }

  const disconnect = async () => {
    setBusy(true)
    setError('')
    try { await api.disconnectClaude(); onChange() }
    catch { setError(t('Failed to disconnect Claude.')) }
    finally { setBusy(false) }
  }

  return (
    <section aria-label="Claude" className="my-4 rounded-xl border border-kumo-line bg-kumo-base p-4">
      <h2 className="font-medium text-kumo-default">Claude</h2>
      <p className="my-2 text-sm text-kumo-subtle">
        {account
          ? t('Claude is connected', { email: account.email ?? '' })
          : t('Connect your Claude plan to use its models. First sign-in runs a helper on your PC.')}
      </p>
      <div className="flex gap-2">
        {canConnect && <Button disabled={busy} onClick={() => setOpen(true)}>
          {account ? t('Replace credential file') : 'Continue with Claude'}
        </Button>}
        {account && <Button variant="secondary" disabled={busy} onClick={disconnect}>
          {t('Disconnect Claude')}
        </Button>}
      </div>
      <Dialog.Root open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
        <Dialog className="p-6" size="lg">
          <Dialog.Title>Continue with Claude</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-kumo-subtle">
            {t('Run the sign-in helper on the PC where this app\'s source lives, then import the file it wrote.')}
          </Dialog.Description>
          <ol className="my-4 list-inside list-decimal space-y-3 text-sm text-kumo-default">
            <li>
              {t('Run the helper in a terminal:')}
              <pre className="mt-2 overflow-x-auto rounded bg-kumo-tint p-3">node scripts/claude-signin.mjs</pre>
            </li>
            <li>{t('Open the URL it prints, approve your Claude plan, and let it write .local/claude-credentials.json.')}</li>
            <li>{t('Import that file here:')}
              <input className="mt-2 block w-full" type="file" accept=".json,application/json"
                disabled={busy} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = '' }} />
            </li>
          </ol>
          {error && <p role="alert" className="mt-2 text-sm text-kumo-danger">{error}</p>}
          <Button className="mt-4" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
            {t('Close')}
          </Button>
        </Dialog>
      </Dialog.Root>
    </section>
  )
}
