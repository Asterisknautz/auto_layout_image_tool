
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
