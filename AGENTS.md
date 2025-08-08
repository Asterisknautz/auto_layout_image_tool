# Repository Guidelines

## プロジェクト構成 / Module 位置
- `src/`: アプリ本体。`components/`（UI, React, PascalCase）、`worker/`（画像処理・推論ロジック, lower-case TS）、`types/`（型定義）、`test/`（Vitest）。
- `public/`: 静的アセット（ファイル名で公開）。`src/assets/` はバンドル対象。
- `tests/`: E2E/ビジュアル回帰（Playwright）。
- `dist/`: ビルド成果物（コミットしない）。
- `docs/`, `README.md`: ドキュメント。
- 注意: コンポーネントは `src/components/` に配置（`src/componets/` は使用しない）。

## ビルド・実行・テスト
- 開発サーバ: `pnpm dev`（Vite 起動, HMR）。
- ビルド: `pnpm build`（`tsc -b` → `vite build`）。
- プレビュー: `pnpm preview`（ビルド成果物のローカル確認）。
- Lint: `pnpm lint`（ESLint 実行）。
- 単体/統合: `pnpm test`（Vitest 実行）, 監視 `pnpm test:watch`。
- E2E: `pnpm test:e2e`（Playwright。`pnpm dev` を再利用）。
- 推奨実行環境: Volta 設定 `node@22.18.0`。パッケージは `pnpm` を使用。

## コーディング規約・命名
- 言語: TypeScript + React。インデント 2 スペース。ESLint に準拠（`eslint.config.js`）。
- コンポーネント: `PascalCase`（例: `CanvasEditor.tsx`）。フック: `useXxx`。
- ワーカー/ユーティリティ: lower-case/簡潔名（例: `worker/yolo.ts`, `worker/opencv.ts`）。
- 配置原則: UI = `components/`、計算/IO = `worker/`、型 = `types/`。

## テスト指針
- 単体: Vitest。対象は `src/test/**/*.{test,spec}.{ts,tsx}`（`vitest.config.ts`）。
- 環境: 既定は `node`。DOM が必要なら `jsdom` へ切替可。
- E2E/視覚回帰: Playwright（`tests/visual.spec.ts` 参照）。`pixelmatch` による差分許容を利用。
- 命名: `xxx.test.ts(x)` / `xxx.spec.ts(x)`。新機能は最小限のテスト同梱。

## コミット & PR ガイドライン
- コミット: Conventional Commits を推奨（例: `feat: add usage accordion`, `fix: resolve asset path`, `chore(test): tweak snapshot`）。
- PR 要件: 目的/背景、主要変更点、テスト方法、関連 Issue、UI 変更はスクリーンショット/比較画像。CI（lint/test）を通過すること。

## セキュリティ / 設定 Tips
- 大きなモデル/バイナリ（例: `yolov8n.pt`）は不要な更新を避ける。必要なら Git LFS を検討。
- ワーカー間のメッセージは構造化クローン可能なデータのみを渡す。ファイル入出力やドラッグ&ドロップは型/サイズを検証。
