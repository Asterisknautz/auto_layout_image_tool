
# 🛠️ 既存 Python ツールの機能を TS-PWA に移植する指示書

## 0. ゴール

* **Vite + React + TypeScript + PWA** 版で、元 CLI が持っていた ①YOLO 切り抜き ②レイアウト合成 ③PSD 書き出し の３機能を動かす。
* 処理は **Web Worker (`src/worker/core.ts`)** 内で完結。UI スレッドとは `postMessage` or Comlink で通信。
* 既存の **JSON レイアウトフォーマット** (`output_profiles.json`) をそのまま受け取れるようにする。
* 最低限のユニットテストが通る（`pnpm test` 緑）。

---

## 1. ディレクトリと担当ファイル

```
src/
  worker/
    core.ts            <-- ★ここがメイン実装ポイント
    yolo.ts            <-- ★ONNX 推論ラッパ (新規)
    opencv.ts          <-- ★Crop/Resize ヘルパ (新規)
    psd.ts             <-- ★PSD 生成 (新規)
  components/
    Dropzone.tsx       <-- UI: 画像読み込み
    CanvasEditor.tsx   <-- UI: Fabric.js で編集
    OutputPanel.tsx    <-- UI: プロファイル選択・実行
  test/
    detect.test.ts     <-- 推論結果 JSON が期待と一致
    visual.spec.ts     <-- Canvas 出力とゴールデン比較
public/models/
  yolov8n.onnx         <-- 3〜5 MB 量子化済み
output_profiles.json   <-- 既存フォーマット
```

---

## 2. 実装タスク一覧

### A. YOLO 推論モジュール

* **`src/worker/yolo.ts`**

  1. `onnxruntime-web` を import。
  2. `init()` でモデルをプリロード & セッション保持。
  3. `detect(imageData: ImageData, conf=0.25, iou=0.45)` → `Prediction[]` を返す。
    4. バウンディングボックスのフィルタ (min\_area, aspect\_ratio) を旧 CLI と同等に。

### B. Crop / Resize

* **`src/worker/opencv.ts`**

  1. `opencv.js`（Emscripten ビルド）を動的 import。
  2. `cropAndResize(img: ImageBitmap, bbox, sizes[])` → `{[sizeName]: ImageBitmap}`。
  3. `pad` オプション対応 (`white`, `transparent`, `custom rgb`).

### C. PSD 生成

* **`src/worker/psd.ts`**

  1. `ag-psd` の `writePsd` を使い、レイヤを順序どおりに配置。
  2. GUI/UI で `export_psd = true` の場合だけ動かす。
  3. 返り値は `Blob`（`image/vnd.adobe.photoshop`）。

### D. Worker エントリ

* **`src/worker/core.ts`**

  * `onmessage` で `type` スイッチ:

    ```ts
    type Message =
      | { type: 'init' }
      | { type: 'detect', payload: { fileId: string, imageData: ImageData } }
      | { type: 'compose', payload: ComposePayload };
    ```
  * detect → opencv → compose → psd までのパイプラインを呼び出す。
  * 各ステージ終了ごとに `{type: 'progress', step: 'detect', ...}` を postMessage。

### E. React UI

* **Dropzone.tsx**

  * `react-dropzone` or HTML5 DnD でファイルを受信。
  * 受信した `File` → `createImageBitmap` → Worker へ `detect`。
* **CanvasEditor.tsx**

  * Fabric.js でバウンディングボックス、リサイズハンドル表示。
  * 編集結果を `ComposePayload` にまとめる。
* **OutputPanel.tsx**

  * `select` で `output_profiles.json` のキーを選ばせる。
  * 「Run」ボタン → Worker に `compose` メッセージ。

### F. テスト更新

* **detect.test.ts**

  * `sample.jpg` を読む → Worker `detect` → 期待 JSON と `expect().toMatchObject()`
* **visual.spec.ts**

  * Playwright で `/` を開く → ドラッグ & compose → `page.screenshot()` とゴールデン比較。

---

## 3. Accept Criteria

* `pnpm dev` でブラウザ UI → 画像 drop → 自動 cropping → プロファイル選択 → `Run` → **multi-size PNG/JPEG ＋ PSD** がダウンロードされる。
* `pnpm build && pnpm preview` でも同じ流れで動く。
* `pnpm test` 緑。
  （detect.test.ts が 1 件成功、visual.spec.ts が `pixelmatch diff == 0`）

---

## 4. 実装メモ & 制約

* **Worker と UI の通信用に Comlink を使っても良い**（依存追加可）
* `opencv.js` の WASM は 2 〜 3 MB 程度、`public/libs/` に置く。
* 画像 I/O は `createImageBitmap` / `OffscreenCanvas` 経由でメモリ効率良く。
* 量子化 ONNX のロード時間 ≦ 300 ms @ M1 Safari を目標。
* PSD はスマートオブジェクト不要、ラスタレイヤのみで OK。

---

## 5. 次のステップ例（今は不要）

* モバイル向け UI レスポンシブ化
* IndexedDB へジョブ履歴保存
* Web Share Target PWA 化（Android で「共有 → 本アプリ」）

---

## 6. 長期ロードマップ（共有メモ）

* 自動推論で失敗したケースに対する **手動補正フローの改善**
  * 画像一覧 → 詳細 → 調整 → 保存 → 一覧再反映 → 出力 までの一貫処理を UI で完結できるようにする。
  * 調整後のバウンディングボックスなどを **学習データとして蓄積** し、YOLO モデルの再学習に回すワークフローを検討。
  * 半自動でモデル更新が行えるよう、調整履歴のエクスポート／教師データ化の仕様を設計する。

---

## 7. ESLint / 型安全化ロードマップ

**Stage 0: 共通基盤整備**
* `pnpm typecheck:test` を CI へ統合（テストコードの型崩れ検知）。
* `pnpm lint` 失敗メッセージを APM 代わりに記録、優先度を随時見直す。

**Stage 1: Worker / Utils の `any` 排除**
* `src/worker/core.ts`, `src/worker/opencv.ts`, `src/utils/fileSystem.ts` など純粋ロジックから着手。`unknown` → 明示型 or Result 型に置き換える。
* `worker` ↔ `UI` メッセージの型を `types/worker.ts` に集約し、`postMessage`/`onmessage` の `any` を除去。

**Stage 2: React Hooks 依存整備**
* `Dropzone.tsx`, `OutputPanel.tsx`, `LayoutSettings.tsx` の `useEffect/useCallback` 依存を再設計。サービス層切り出しと合わせて `eslint-plugin-react-hooks` の警告を解消。
* `profiles` / `batchData` の状態は Context or Zustand へ移し、単一責務でテスト可能な単位を作る。

**Stage 3: テストユーティリティ整理**
* `src/test/**/*.ts` のモック定義を共通ヘルパに移し、`any` や `@ts-ignore` を `vi.mock` ラッパで吸収。
* 型安全が確保されたら `pnpm lint` を CI 必須に戻す。

**Stage 4: 抽出ロジック整合性とリリース準備**
* [ ] 商品抽出ロジックを実際のデータセットで検証し、誤検出パターンの補正やパラメータ調整を反映する。
* [ ] 手動調整内容を Web Storage とエクスポートファイルへ永続化し、次回起動時に復元できるようにする。
* [ ] YOLO フィードバック用に、調整後のバウンディングボックスやメタデータを教師データとして保存する導線を用意する。
* [ ] 設定ファイル（`output_profiles.json` など）を自動読み込みし、環境差分を吸収できる仕組みを整える。
* [ ] UI の最終調整（アコーディオン整理やビルド情報表示の開発限定化）と Vercel へのデプロイ設定・動作確認を完了する。

---

## 8. 一時メモ（2025-09-24）

- [ ] Vercel のプロジェクト設定で Node.js 22 系を固定（`Settings → General → Node.js Version` もしくは `NODE_VERSION=22.18.0`）。
- [ ] Production デプロイで保存先設定バナーと出力プロファイル（PC のみ有効）が期待通り表示されるか確認。
- [ ] `public/output_profiles.json` のデフォルト変更について README / リリースノートへ反映するか検討。
