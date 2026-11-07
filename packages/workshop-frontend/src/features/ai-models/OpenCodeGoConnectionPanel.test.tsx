// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, OpenCodeGoAccountInfo } from '@gadgets/workshop-shared/api'
import { OpenCodeGoConnectionPanel } from './OpenCodeGoConnectionPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = '' })

const render = async (account: OpenCodeGoAccountInfo | null = null, canConnect = true) => {
  const api = {connectOpenCodeGo: vi.fn<(token: string) => Promise<void>>(async () => {}),
    refreshOpenCodeGoModels: vi.fn<() => Promise<void>>(async () => {}),
    disconnectOpenCodeGo: vi.fn<() => Promise<void>>(async () => {})}
  const onChange = vi.fn<() => void>()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<OpenCodeGoConnectionPanel api={api as unknown as RpcStub<AuthenticatedApi>}
    account={account} canConnect={canConnect} onChange={onChange} />))
  return {api, onChange}
}
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(element => element.textContent === text)!

describe('Go connection settings', () => {
  it('registers one key for all models and clears the key from the form after success', async () => {
    const {api, onChange} = await render()
    expect(button('Goを接続').disabled).toBe(true)
    const input = document.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'personal-key')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await act(async () => button('Goを接続').click())
    expect(api.connectOpenCodeGo).toHaveBeenCalledWith('personal-key')
    expect(input.value).toBe('')
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('refreshes without re-entering the key and preserves the displayed catalog on failure', async () => {
    const {api, onChange} = await render({modelIds: ['model'], modelCount: 37, updatedAt: 1, stale: false})
    api.refreshOpenCodeGoModels.mockRejectedValueOnce(new Error('前回の一覧は保持しています。'))
    await act(async () => button('一覧を更新').click())
    expect(api.refreshOpenCodeGoModels).toHaveBeenCalledOnce()
    expect(api.connectOpenCodeGo).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('37モデル')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('前回の一覧は保持')
  })

  it('still allows disconnection when the administrator disallows adding models', async () => {
    const {api} = await render({modelIds: ['model'], modelCount: 1, updatedAt: 1, stale: false}, false)
    expect(document.querySelector('input')).toBeNull()
    expect(button('一覧を更新')).toBeUndefined()
    await act(async () => button('Goを切断').click())
    expect(api.disconnectOpenCodeGo).toHaveBeenCalledOnce()
  })
})
