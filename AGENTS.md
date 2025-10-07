# Repository Guidelines

## プロジェクト概要とスタック
- 商品画像 の バッチ処理 パイプライン。YOLO v8 検出 手動トリミング プロファイル別 レイアウト 合成 PSD PNG JPG 出力 を 実現。
- React 19 TypeScript Vite 製 UI。Fabric.js と react-dropzone が キャンバス編集 と ドラッグ受付 を 担当。
- Web Worker 上 で YOLO OpenCV.js PSD 生成 を 実行 し File System Access API で 永続化。Volta で node@22.18.0 と pnpm を 固定。

## ディレクトリと主要モジュール
- `src/components/`: `App.tsx` が Worker 連携。`Dropzone.tsx` は フォルダ 取り込み と 検出起動。`CanvasEditor.tsx` は Fabric.js による 調整。`LayoutSettings.tsx` は プロファイル UI。`OutputPanel.tsx` は 自動保存 と トースト通知。
- `src/worker/`: `core.ts` ルーティング。`yolo.ts` ONNX 推論。`opencv.ts` クロップ と リサイズ。`psd.ts` レイヤー 書き出し。
- プロファイル 状態 は `src/context/ProfilesContext.tsx`。初期値 は `public/output_profiles.json`。`src/utils/` には ファイルシステム 管理 デバッグ 切替 永続化 ルート 制御 を まとめる。

## 処理フローとプロファイル
- フロー: `Dropzone` → `worker/yolo` → `CanvasEditor` → Compose Payload → `worker/opencv` `worker/psd` → `OutputPanel`。
- バッチ は フォルダ グループ と `composeMany` で 再合成 を 最適化。
- 出力 は `{group}_{profile}.{ext}`。`output_profiles.json` が サイズ フォーマット レイアウト (縦横比 で vertical horizontal square) を 指定。
- 入力 制御: 12 枚 超 で 警告。対応 形式 JPG PNG WebP GIF BMP。50MB 超 を 拒否 し ファイル別 エラー を 表示。

## ビルド テスト 開発コマンド
- `pnpm dev`: Vite HMR サーバー。Playwright 実行 前 に 起動。
- `pnpm build`: `tsc -b` の後 `vite build`。
- `pnpm preview`: `dist/` を ローカル 提供。
- `pnpm lint`: ESLint Prettier ルール。
- `pnpm test` `pnpm test:watch`: Vitest。
- `pnpm test:e2e`: Playwright ビジュアル 回帰。
- `pnpm typecheck:test`: テストコードの型検査 (tsconfig.test.json)。

## コーディング規約と命名
- TypeScript React インデント 2 スペース。`eslint.config.js` に 従う。
- コンポーネント と フック は PascalCase `useXxx`。ワーカー ユーティリティ は lowercase (`worker/yolo.ts`)。
- 静的 アセット は `public/`。バンドル 対象 は `src/assets/`。

## テスト指針
- テスト は `src/test/**/*.{test,spec}.{ts,tsx}`。Node が 既定。DOM 必要時 は jsdom。
- Vitest で コア ロジック 自動保存 ストレージ フロー を カバー。フィクスチャ は 小規模。
- `tests/visual.spec.ts` で Playwright と `pixelmatch` 差分 を 検証。

## コミット と PR ガイドライン
- Conventional Commits 推奨 (`feat: add usage accordion` `fix: resolve asset path` `chore(test): tweak snapshot`)。
- PR は 背景 主要変更 検証手順 関連 Issue UI 変更 の 比較画像 を 記載。
- lint unit e2e を クリア して から レビュー を 依頼。

## 運用とハードニング
- `yolov8n.pt` など 大型 アセット の ノイズ 変更 を 回避。必要 なら Git LFS。
- Worker メッセージ は 構造化 クローン 可能 データ に 限定 し ドラッグ 入力 の 種類 サイズ を 検証。
- 設定 変更 に 伴う 再合成 と リトライ を 案内 し メモリ 使用 を 監視。
