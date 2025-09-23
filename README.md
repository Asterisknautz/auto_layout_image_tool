# Imagetool PWA (Beta)

Imagetool は商品画像のバッチ処理パイプラインを、ブラウザ上で完結させる React + TypeScript + Vite 製 PWA です。YOLO v8 による物体検出、OpenCV.js のクロップ／リサイズ、PSD 書き出しまでを Web Worker 上で実行し、File System Access API を使ってローカルへ保存します。

## 主な機能
- フォルダドラッグ & ドロップでの一括入力 (`Dropzone.tsx`)
- YOLO 推論による自動バウンディングボックス生成 (`src/worker/yolo.ts`)
- Fabric.js キャンバスでの手動補正 (`CanvasEditor.tsx`)
- プロファイル別レイアウト合成と PNG/JPG/PSD 書き出し (`src/worker/opencv.ts`, `src/worker/psd.ts`)
- `output_profiles.json` に基づくサイズ・フォーマット定義の読み込み

## ベータステータス
現状は「実用ベータ」として公開しています。以下の制限・注意事項をご確認ください。
- Playwright ベースのビジュアル回帰テスト (`src/test/visual.spec.ts`) は一時的に skip しています。
- 初回ロード時に YOLO (約 3 MB) と OpenCV/WASM (合計 ~28 MB) を読み込むため、ネットワーク環境によっては表示まで時間がかかります。
- モバイル向け UI 最適化は今後の対応予定です。
- 大容量ファイルや 12 枚超の同時入力時は警告が出ますが、ブラウザメモリ状況によっては動作が不安定になる場合があります。

既知の制限は Issue に順次追記していきます。改善に向けたフィードバックを歓迎します。

## セットアップ
```bash
pnpm install
```
Volta を利用しており、Node.js `22.18.0` / pnpm が自動で選択されます。

## 開発用コマンド
| コマンド | 説明 |
| --- | --- |
| `pnpm dev` | Vite 開発サーバーを起動 (HMR) |
| `pnpm build` | TypeScript ビルド + Vite 本番ビルド |
| `pnpm preview` | `dist/` をローカルサーバーで配信 (手動 QA 用) |
| `pnpm lint` | ESLint / Prettier ルールチェック |
| `pnpm test` | Vitest 実行 (`visual.spec.ts` はベータ中 skip) |
| `pnpm test:e2e` | Playwright (ベータ中は任意) |

## 手動 QA のすすめ
1. `pnpm build`
2. 別ターミナルで `pnpm preview`
3. ブラウザで `http://localhost:4173` を開き、フォルダをドラッグ & ドロップ
4. JPG/PNG/PSD が期待通り保存されることを確認

公開前に上記フローでひと通り動作確認することを推奨します。

## デプロイ (Vercel)
GitHub の main ブランチへ push すると Vercel で自動デプロイされるように設定します。詳細手順は `docs/vercel-deploy.md` を参照してください。

## ライセンス
本リポジトリは社内利用を想定した WIP プロジェクトです。ライセンスは別途検討中です。
