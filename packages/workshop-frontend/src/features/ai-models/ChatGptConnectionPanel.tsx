import { useState } from 'react'
import { Button, Dialog } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'

export const ChatGptConnectionPanel = ({ api, account, canConnect, onChange }: {
  api: RpcStub<AuthenticatedApi>
  account: {email?: string} | null
  canConnect: boolean
  onChange: () => void
}) => {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const importFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 65536) { setError('認証ファイルが大きすぎます。'); return }
    setBusy(true)
    setError('')
    try {
      await api.importChatGpt(await file.text())
      setOpen(false)
      onChange()
    } catch {
      setError('接続できませんでした。補助ツールで再認証して、新しいファイルを登録してください。')
    } finally { setBusy(false) }
  }

  const disconnect = async () => {
    setBusy(true)
    setError('')
    try {
      const revoked = await api.disconnectChatGpt()
      if (!revoked) setError('このアプリから切断しました。ChatGPT側の解除は確認できなかったため、ChatGPTの設定からも接続を解除してください。')
      onChange()
    }
    catch { setError('切断できませんでした。もう一度お試しください。') }
    finally { setBusy(false) }
  }

  return (
    <section aria-label="ChatGPT" className="my-4 rounded-xl border border-kumo-line bg-kumo-base p-4">
      <h2 className="font-medium text-kumo-default">ChatGPT</h2>
      <p className="my-2 text-sm text-kumo-subtle">
        {account ? `ChatGPT接続済み${account.email ? `（${account.email}）` : ''}。モデルはこのアカウントのプランを利用します。`
          : 'ご自身のChatGPTプランを接続できます。初回はPCでの認証が必要です。'}
      </p>
      <div className="flex gap-2">
        <Button disabled={busy || !canConnect} onClick={() => { setError(''); setOpen(true) }}>Continue with ChatGPT</Button>
        {account && <Button variant="secondary" disabled={busy} onClick={disconnect}>ChatGPTを切断</Button>}
      </div>
      {error && !open && <p role="alert" className="mt-2 text-sm text-kumo-danger">{error}</p>}
      <Dialog.Root open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
        <Dialog className="p-6" size="lg">
          <Dialog.Title>Continue with ChatGPT</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-kumo-subtle">PCで認証してから、作成されたファイルを登録してください。</Dialog.Description>
          <ol className="my-4 list-inside list-decimal space-y-3 text-sm text-kumo-default">
            <li>このアプリのソースを置いたPCで、次のコマンドを実行します。
              <pre className="mt-2 overflow-x-auto rounded bg-kumo-tint p-3">node scripts/chatgpt-signin.mjs</pre>
            </li>
            <li>表示されたURLを同じPCのブラウザーで開き、ChatGPTプランの利用を許可します。</li>
            <li>作成された <code>.local/chatgpt-credentials.json</code> を下で選択します。
              登録後はこのアプリがトークンを更新します。PCを起動し続ける必要はありません。
            </li>
          </ol>
          <label className="block text-sm text-kumo-default">
            ChatGPT認証ファイル
            <input className="mt-2 block w-full" type="file" accept=".json,application/json"
              disabled={busy} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = '' }} />
          </label>
          <p className="mt-2 text-sm text-kumo-subtle">認証情報はログイン中のユーザー専用としてサーバーに保存します。登録後はローカルの認証ファイルを削除してください。</p>
          {error && <p role="alert" className="mt-2 text-sm text-kumo-danger">{error}</p>}
          <Button className="mt-4" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>閉じる</Button>
        </Dialog>
      </Dialog.Root>
    </section>
  )
}
