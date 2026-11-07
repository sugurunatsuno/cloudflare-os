import { useState } from 'react'
import { Button, SensitiveInput } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useI18n } from '../../i18n'

export const GeminiConnectionPanel = ({ api, account, canConnect, onChange }: {
  api: RpcStub<AuthenticatedApi>
  account: {modelCount: number} | null
  canConnect: boolean
  onChange: () => void
}) => {
  const { t } = useI18n()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await operation(); setKey(''); onChange() }
    catch { setError(t('Failed to update the Gemini connection.')) }
    finally { setBusy(false) }
  }

  return (
    <section aria-label="Gemini" className="my-4 rounded-xl border border-kumo-line bg-kumo-base p-4">
      <h2 className="font-medium text-kumo-default">Gemini</h2>
      <p className="my-2 text-sm text-kumo-subtle">
        {account
          ? t('Gemini is connected', { count: account.modelCount })
          : t('Paste a Google AI Studio API key once to add the Gemini models to chat.')}
      </p>
      {canConnect && (
        <SensitiveInput label={t('Gemini API key')} placeholder={account ? t('Only to change it') : 'AIza...'}
          value={key} onValueChange={setKey} disabled={busy} />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {canConnect && <Button disabled={busy || !key.trim()} onClick={() => { void run(() => api.connectGemini(key)) }}>
          {account ? t('Change API key') : t('Connect Gemini')}
        </Button>}
        {account && <Button variant="secondary" disabled={busy} onClick={() => { void run(() => api.disconnectGemini()) }}>
          {t('Disconnect Gemini')}
        </Button>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-kumo-danger">{error}</p>}
    </section>
  )
}
