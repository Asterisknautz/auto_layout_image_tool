# Vercel デプロイ手順 (GitHub → 自動更新)

本ドキュメントでは、GitHub の `main` ブランチに push すると Vercel 上の本番サイトが自動で更新されるように設定する手順をまとめます。

## 前提条件
- Vercel アカウントを作成済み
- GitHub リポジトリに本プロジェクトが常に push されている
- `pnpm install && pnpm build` がローカルで成功する (ベータ中は `pnpm test` で `visual.spec.ts` が skip される状態で OK)

## プロジェクトのインポート
1. https://vercel.com/dashboard で **Add New… → Project** を選択。
2. GitHub 連携を許可し、リストから `imagetool` リポジトリを選ぶ。
3. 「Framework Preset」は **Vite** を選択 (Vercel が自動判定する場合あり)。

## Build & Development Settings
| 設定項目 | 値 |
| --- | --- |
| Build Command | `pnpm build` |
| Output Directory | `dist` |
| Install Command | (デフォルト: `pnpm install --frozen-lockfile`) |
| Development Command | 空欄で OK |

> `pnpm build` は `scripts/prebuild-info` → `tsc -b` → `vite build` の順に実行されます。Vercel でも問題なく動作します。

## Node / pnpm バージョン設定
- Vercel のプロジェクト設定 → **General → Node.js Version** を `22` に変更します。
  - もしくは **Environment Variables** に `NODE_VERSION = 22.18.0` を追加しても構いません。
- pnpm は Vercel が自動で 9 系を提供するため追加設定不要です。

## 環境変数 (任意)
ベータ表示用などで UI にフラグを渡したい場合は、`VITE_APP_ENV=beta` のように `VITE_` prefix の変数を追加してください。

## Large Asset 対応
- `public/models/yolov8n.onnx` や OpenCV WASM など大きめのアセットがキャッシュ対象になります。`vercel.json` で COOP/COEP を設定済みのため追加設定は不要ですが、初回アクセスで 20 MB 超のダウンロードが発生する点にご注意ください。
- Asset Optimization は無効のまま (デフォルト) で問題ありません。

## 自動デプロイ確認
1. 初回デプロイ後、Vercel の `Production Deployment` URL にアクセスし、フォルダをドロップして JPG/PSD がダウンロードできることを確認します。
2. `main` ブランチへ push するたびに `Production` デプロイが更新されます。
3. Pull Request ブランチは `Preview Deployment` として個別 URL が発行され、ベータ検証にも利用できます。

## 推奨ワークフロー
1. 変更作業 → `pnpm test` を実行 (ベータ中はビジュアルテスト skip を許容)。
2. `pnpm build && pnpm preview` で手動 QA。
3. `main` にマージし push。
4. Vercel のデプロイ完了通知を確認し、Production URL で最終確認。

## トラブルシューティング
- **Build Step で Node バージョンエラー**: Node が 18.x のままの可能性があります。`NODE_VERSION` が 22 系になっているか確認してください。
- **onnxruntime / OpenCV の読み込み失敗**: 静的アセットが配信されているか (404 になっていないか) を Network タブで確認。`public/models/` 以下が含まれるように `git lfs` などを避けて通常コミットしてください。
- **Service Worker の更新が反映されない**: Vercel で再デプロイ後、ブラウザのキャッシュをクリアするか `Update on reload` を有効にして再訪問してください。

ベータ期間中はこの手順に従い、問題が起きた場合は Issue で共有してください。
