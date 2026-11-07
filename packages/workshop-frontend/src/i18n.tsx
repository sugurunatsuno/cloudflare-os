import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Language = 'en' | 'ja'

// v2 deliberately resets the initial preference to Japanese. The first release used the browser
// locale as its default, which could permanently leave Japanese users in English after an initial
// visit. English remains available as an explicit choice in Profile > Language.
const LANGUAGE_STORAGE_KEY = 'gadgets:language-v2'

// The English source text is intentionally used as the key. This keeps the first localization
// pass small and makes untranslated text continue to work while new screens are added.
const JA: Record<string, string> = {
  'Sign in': 'ログイン',
  'Sign in to your account': 'アカウントにログイン',
  'Create account': 'アカウントを作成',
  'Create your account': 'アカウントを作成しましょう',
  'Username': 'ユーザー名',
  'Password': 'パスワード',
  'Confirm Password': 'パスワード（確認）',
  'Confirm new password': '新しいパスワード（確認）',
  'Current password': '現在のパスワード',
  'New password': '新しいパスワード',
  'Enter current password': '現在のパスワードを入力',
  'Enter new password': '新しいパスワードを入力',
  'Letters, numbers, underscores, and hyphens only': '英字、数字、アンダースコア、ハイフンのみ使用できます',
  'Must be at least 8 characters': '8文字以上で入力してください',
  'Passwords do not match': 'パスワードが一致しません',
  'Invalid username or password': 'ユーザー名またはパスワードが正しくありません',
  'Login failed': 'ログインに失敗しました',
  'Username already exists': 'そのユーザー名は既に使用されています',
  'Account creation failed': 'アカウントの作成に失敗しました',
  "Don't have an account?": 'アカウントをお持ちでない場合は？',
  'Already have an account?': 'すでにアカウントをお持ちですか？',
  'Create one': '作成する',
  'Signups are closed': '新規登録は終了しています',
  'New account registration is currently disabled on this deployment.': 'この環境では現在、新規アカウント登録が無効になっています。',
  'Couldn\'t load deployment settings.': 'デプロイ設定を読み込めませんでした。',
  'Reload': '再読み込み',
  "Can't reach the server. Retrying…": 'サーバーに接続できません。再試行しています…',
  'Loading…': '読み込み中…',
  'Loading...': '読み込み中…',
  'Authenticating...': '認証中…',
  'Authentication error': '認証エラー',
  'Retry': '再試行',
  'or': 'または',
  'Home': 'ホーム',
  'Workspaces': 'ワークスペース',
  'Blueprints': 'ブループリント',
  'Outputs': '成果物',
  'Explore': '探索',
  'Gatekeepers': 'ゲートキーパー',
  'Favorites': 'お気に入り',
  'Recent workspaces': '最近のワークスペース',
  'Favorite a workspace to keep it here.': 'ワークスペースをお気に入りに追加すると、ここに表示されます。',
  'No matches.': '一致する項目がありません。',
  'No workspaces yet.': 'ワークスペースはまだありません。',
  'Show all': 'すべて表示',
  'Search': '検索',
  'Search (⌘K)': '検索（⌘K）',
  'Collapse sidebar': 'サイドバーを折りたたむ',
  'Expand sidebar': 'サイドバーを展開',
  'Primary navigation': 'メインナビゲーション',
  'Close menu': 'メニューを閉じる',
  'Open menu': 'メニューを開く',
  'Profile': 'プロフィール',
  'Providers': 'プロバイダー',
  'Admin': '管理',
  'Sign out': 'ログアウト',
  'Theme: system': 'テーマ：システム',
  'Theme: light': 'テーマ：ライト',
  'Theme: dark': 'テーマ：ダーク',
  'Switch to': '切り替え先：',
  'Account': 'アカウント',
  'Security': 'セキュリティ',
  'Manage your account details, avatar, and security.': 'アカウント情報、アバター、セキュリティを管理します。',
  'Display name': '表示名',
  'Enter display name': '表示名を入力',
  'Save': '保存',
  'Cancel': 'キャンセル',
  'Edit display name': '表示名を編集',
  'Save display name': '表示名を保存',
  'User ID': 'ユーザーID',
  'Copy user ID': 'ユーザーIDをコピー',
  'Click the avatar to upload a new photo': 'アバターをクリックして新しい画像をアップロード',
  'Change password': 'パスワードを変更',
  'Changing…': '変更中…',
  'Failed to load user information': 'ユーザー情報の読み込みに失敗しました',
  'Display name cannot be empty': '表示名を空にすることはできません',
  'Display name updated': '表示名を更新しました',
  'Failed to update display name': '表示名の更新に失敗しました',
  'User ID copied': 'ユーザーIDをコピーしました',
  'Failed to copy': 'コピーに失敗しました',
  'Please select an image file': '画像ファイルを選択してください',
  'Avatar updated': 'アバターを更新しました',
  'Failed to upload avatar': 'アバターのアップロードに失敗しました',
  'Password changed successfully': 'パスワードを変更しました',
  'Failed to change password': 'パスワードの変更に失敗しました',
  'Loading profile…': 'プロフィールを読み込み中…',
  'Language': '言語',
  'Japanese': '日本語',
  'English': '英語',
  'Language preference': '表示言語',
  'Choose the language used throughout Cloudflare OS.': 'Cloudflare OS全体で使用する言語を選択します。',
  'Show password': 'パスワードを表示',
  'Hide password': 'パスワードを隠す',
  'Add AI Model': 'AIモデルを追加',
  'Select Provider': 'プロバイダーを選択',
  'Select Model': 'モデルを選択',
  'Choose a provider...': 'プロバイダーを選択…',
  'Choose an AI model...': 'AIモデルを選択…',
  'Model ID': 'モデルID',
  'Display Name': '表示名',
  'API Token': 'APIトークン',
  'API URL': 'API URL',
  'Other': 'その他',
  'Please select a provider': 'プロバイダーを選択してください',
  'Please select a model': 'モデルを選択してください',
  'Please enter the model ID': 'モデルIDを入力してください',
  'Please enter a display name': '表示名を入力してください',
  'Please enter your API token': 'APIトークンを入力してください',
  'Please enter your Cloudflare account ID': 'CloudflareアカウントIDを入力してください',
  'Please enter the Ollama API URL': 'Ollama API URLを入力してください',
  'Cloudflare Account ID': 'CloudflareアカウントID',
  'Advanced Settings': '詳細設定',
  'The model identifier as specified by the provider (e.g., {modelId})': 'プロバイダーが指定するモデル識別子（例：{modelId}）',
  'Human-readable name shown in the UI': 'UIに表示する名前',
  'The Cloudflare account to bill for Workers AI usage': 'Workers AIの利用料金を請求するCloudflareアカウント',
  'Optional for local Ollama access': 'ローカルのOllama接続では任意です',
  'An API token with Workers AI Read + Edit permissions (in the dashboard: Workers AI > Use REST API > Create a Workers AI API Token)': 'Workers AIのRead + Edit権限を持つAPIトークン（ダッシュボードの Workers AI > Use REST API > Create a Workers AI API Token から作成）',
  'Your {provider} API token for billing': '請求に使用する{provider}のAPIトークン',
  'URL of your Ollama server': 'OllamaサーバーのURL',
  'Override the default API endpoint (useful for proxies like Cloudflare AI Gateway)': 'デフォルトのAPIエンドポイントを上書きします（Cloudflare AI Gatewayなどのプロキシに便利です）',
  'Add Model': 'モデルを追加',
  "Couldn't load AI models": 'AIモデルを読み込めませんでした',
  'Failed to create workspace': 'ワークスペースの作成に失敗しました',
  'What are we working on?': '今日は何に取り組みますか？',
  'Ask a question, create an output, or create an app that works with your tools and data.': '質問したり、成果物を作ったり、ツールやデータと連携するアプリを作成できます。',
  'Waiting for agent…': 'エージェントを待機中…',
  'Start a new conversation…': '新しい会話を始める…',
  'Ask a follow-up…': '続きを入力…',
  'More chat options': 'その他のチャット操作',
  'Hide thinking': '思考過程を隠す',
  'Show thinking': '思考過程を表示',
  'Stop agent': 'エージェントを停止',
  'Send message': 'メッセージを送信',
  'Select model': 'モデルを選択',
  'No agent': 'エージェントなし',
  'Search skills': 'スキルを検索',
  'Search skills…': 'スキルを検索…',
  'Add to conversation': '会話に追加',
  'Files, connections, and skills': 'ファイル、接続、スキル',
  'Upload files or photos': 'ファイルや写真をアップロード',
  'Add a new connection': '新しい接続を追加',
  'Couldn’t load skills.': 'スキルを読み込めませんでした。',
  'No skills match your search.': '検索に一致するスキルがありません。',
  'Loading skills…': 'スキルを読み込み中…',
  'Each workspace is an isolated environment with its own conversations, gatekeepers, and outputs.': '各ワークスペースは、会話・ゲートキーパー・成果物を個別に管理する独立した環境です。',
  'Create workspace': 'ワークスペースを作成',
  "Reusable starting points you've published or saved. Spin up a workspace from any of them.": '公開または保存した再利用可能な出発点です。どれからでもワークスペースを作成できます。',
  'AI Providers': 'AIプロバイダー',
  'AI providers': 'AIプロバイダー',
  'Configure the AI models available to your workspaces.': 'ワークスペースで利用できるAIモデルを設定します。',
  'Add provider': 'プロバイダーを追加',
  'Provider actions': 'プロバイダーの操作',
  'Quick model. Click to clear': 'クイックモデル。クリックで解除',
  'Click to set as quick model': 'クリックしてクイックモデルに設定',
  'Clear quick model': 'クイックモデルを解除',
  'Set as quick model': 'クイックモデルに設定',
  'Delete provider': 'プロバイダーを削除',
  'Search providers…': 'プロバイダーを検索…',
  'AI Gateway mode:': 'AI Gatewayモード：',
  'built-in models are managed by your deployment. You can still add custom models with your own API tokens.': '組み込みモデルはデプロイ設定で管理されています。独自のAPIトークンを使ってカスタムモデルを追加することもできます。',
  'Quick model:': 'クイックモデル：',
  'none set.': '未設定。',
  'Used for fast tasks like generating chat titles. Click a model to set it.': 'チャットタイトルの生成など、高速処理に使用します。モデルをクリックして設定できます。',
  'Something went wrong loading your providers.': 'プロバイダーの読み込み中に問題が発生しました。',
  'Try again': '再試行',
  'No AI providers yet': 'AIプロバイダーはまだありません',
  'Add a provider to start building workspaces with AI.': 'プロバイダーを追加して、AIでワークスペースを作り始めましょう。',
  'Add your first provider': '最初のプロバイダーを追加',
  'No providers found': 'プロバイダーが見つかりません',
  'Built-in': '組み込み',
  'Quick': 'クイック',
  'Delete "{model}"? This cannot be undone.': '「{model}」を削除しますか？この操作は元に戻せません。',
  'Failed to delete provider': 'プロバイダーの削除に失敗しました',
  'Failed to update default model': 'デフォルトモデルの更新に失敗しました',
  'Example tasks': 'タスクの例',
  'Get started': '始めてみる',
  'Write a 1:1 pre-read': '1on1の事前資料を作る',
  'A doc with a snapshot, things to inspect, and one ask': '現状、確認事項、相談事項をまとめたドキュメント',
  'Build a team meeting deck': 'チーム会議の資料を作る',
  'Slides with progress, risks, and what needs a decision': '進捗、リスク、判断が必要な事項をまとめたスライド',
  'Find insights in my data': 'データから洞察を見つける',
  'Turn a spreadsheet or CSV into trends and recommendations': 'スプレッドシートやCSVから傾向と提案を作る',
  'Automate a workflow': 'ワークフローを自動化する',
  'Trigger an agent when a new email arrives': '新しいメールを受信したらエージェントを起動する',
  'Build a quick tool': '簡単なツールを作る',
  'A small interactive app, calculator, or dashboard': '小さなインタラクティブアプリ、計算機、ダッシュボード',
  'AI model added successfully': 'AIモデルを追加しました',
  'Failed to add model': 'モデルの追加に失敗しました',
}

function readInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored === 'ja' || stored === 'en') return stored
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
  return 'ja'
}

function interpolate(value: string, variables?: Record<string, string | number>): string {
  if (!variables) return value
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(variables[name] ?? `{${name}}`))
}

type I18nValue = {
  language: Language
  setLanguage: (language: Language) => void
  t: (text: string, variables?: Record<string, string | number>) => string
}

const defaultI18n: I18nValue = {
  language: 'en',
  setLanguage: () => {},
  t: (text, variables) => interpolate(text, variables),
}

const I18nContext = createContext<I18nValue>(defaultI18n)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readInitialLanguage)
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next) } catch {}
  }, [])
  const t = useCallback((text: string, variables?: Record<string, string | number>) => {
    const translated = language === 'ja' ? (JA[text] ?? text) : text
    return interpolate(translated, variables)
  }, [language])
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
