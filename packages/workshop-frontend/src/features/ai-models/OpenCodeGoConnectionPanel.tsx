import { useState } from 'react'
import { Button, SensitiveInput } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, OpenCodeGoAccountInfo } from '@gadgets/workshop-shared/api'

export const OpenCodeGoConnectionPanel = ({ api, account, canConnect, onChange }: {
  api: RpcStub<AuthenticatedApi>
  account: OpenCodeGoAccountInfo | null
  canConnect: boolean
  onChange: () => void
}) => {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await operation(); setToken(''); onChange() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Goの接続を更新できませんでした。') }
    finally { setBusy(false) }
  }

  return (
    <section aria-label="OpenCode Go" className="my-4 rounded-xl border border-kumo-line bg-kumo-base p-4">
      <h2 className="font-medium text-kumo-default">OpenCode Go</h2>
      <p className="my-2 text-sm text-kumo-subtle">
        {account ? `${account.modelCount}モデルを利用できます。` : 'APIキーを一度登録すると、Goのモデルがチャットの選択肢に追加されます。'}
        一覧はモデル選択時に自動更新します（最大5分間キャッシュ）。
      </p>
      {account && <p className="mb-3 text-sm text-kumo-subtle">
        {account.updatedAt ? `最終更新: ${new Date(account.updatedAt).toLocaleString()}` : '保存済みのGo設定を引き継いでいます。'}
        {account.stale && ' 最新一覧を取得できなかったため、前回の一覧を表示しています。'}
      </p>}
      {canConnect && <SensitiveInput label="OpenCode Go APIキー" placeholder={account ? '変更する場合のみ入力' : 'GoのAPIキー'}
        value={token} onValueChange={setToken} disabled={busy} />}
      <div className="mt-3 flex flex-wrap gap-2">
        {canConnect && <Button disabled={busy || !token.trim()} onClick={() => { void run(() => api.connectOpenCodeGo(token)) }}>
          {account ? 'APIキーを変更' : 'Goを接続'}
        </Button>}
        {account && <>
          {canConnect && <Button variant="secondary" disabled={busy} onClick={() => { void run(() => api.refreshOpenCodeGoModels()) }}>一覧を更新</Button>}
          <Button variant="secondary" disabled={busy} onClick={() => { void run(() => api.disconnectOpenCodeGo()) }}>Goを切断</Button>
        </>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-kumo-danger">{error}</p>}
    </section>
  )
}
