# テストカバレッジレビュー（2025-10-09）

## 1. 既存テストスイートの把握
- `src/test/DirectoryService.test.ts`：出力先ピッカーとローカルストレージ復元の単体テスト。自動検出フローの正常系／エラー系を網羅。
- `src/test/Dropzone.folderDetection.test.ts`：ドラッグ＆ドロップ時のフォルダ名推定ロジックをユニットレベルで検証。
- `src/test/FileExportService.test.ts`：書き出しサービスのフォーマット数計算とワーカーメッセージ送信の検証。PSD指定の切替までは確認済み。
- `src/test/integration.fileSaveFlow.test.ts` / `src/test/integration/ExportIntegration.test.ts`：IO ハンドルとエクスポート処理の結合テスト。主にハンドルの取得と書き込み成功／失敗フローをダブルチェック。
- `src/test/OutputPanel.handleManagement.test.ts`：`ensureDirectoryHandle` のフォールバック順序と `autoSaveSetup` イベント処理のシミュレーション。
- `src/test/outputRootManager.test.ts` / `src/test/handleStorage.test.ts`：出力ルート初期化と IndexedDB ハンドル永続化のテスト。
- `src/test/NotificationService.test.ts`・`src/test/WorkerService.test.ts` 等：周辺サービスの API 契約テスト。
- `src/test/visual.spec.ts`：pixelmatch サンプルの `describe.skip`。実質未使用。
- `tests/visual.spec.ts`：Playwright 由来のパス参照のみ。E2E 実装なし。

## 2. 仕様観点での評価（2025-10-09 時点コードとの差分）
- **拡張子別フォルダ出力**（`src/components/OutputPanel.tsx:190-240`）  
  テスト未整備。`groupByFormat=true` が固定値化された後のパス分岐、ルート直下ファイルのピンポイント削除、異常時のログ分岐を検証するケースが存在しない。
- **`groupByFormat` の伝播**（`src/context/ProfilesContext.tsx:84-110` / `src/components/Dropzone.tsx:773-796` / `src/worker/core.ts:230-266`）  
  プロファイル読込→UI→ワーカーまで一貫して `true` になること、ローカルストレージに残存する旧データで `false` が復元されないことを確認するテストがない。
- **単画像保存ロジックとの統合**（`src/components/OutputPanel.tsx:148-270`）  
  既存の単体保存パスとバッチ保存パスが同一ルーチンで動作することを保証するテストがなく、回 regresion の温床となっている。
- **PSD レイヤー生成・マスク処理**（`src/worker/psd.ts` / `src/worker/core.ts:320+`）  
  既存 Vitest では PSD 生成やマスク適用結果を検証しておらず、Issue H06 で求められるレイヤーマスク仕様の担保がない。
- **UI レベルの仕様**（保存先設定 UI、レイアウト設定見出し、`groupByFormat` 注意書き等）  
  React コンポーネントに対するレンダリングテスト（Testing Library など）が存在しないため、文言変更・コンポーネント構造変更のリグレッションを検出できない。
- **E2E / ビジュアル回帰**  
  Playwright テストは未実装で、UI/ワーカーフローを跨ぐ実働検証は人力頼み。

## 3. 重要ギャップと優先度（H=高, M=中, L=低）
- **H** `OutputPanel` の grouped 保存とルート削除挙動（`src/components/OutputPanel.tsx:190-240`）  
  - 期待値：拡張子フォルダにのみ保存され、同名ルートファイルは削除される。別名ファイルは削除されない。  
  - リスク：再発しやすいバグであり、今回も複数回リグレッションが起きた領域。
- **H** `groupByFormat` の強制 true と旧データ移行（`src/context/ProfilesContext.tsx:84-110`）  
  - 期待値：`output_profiles.json`・ローカルストレージ双方で false が復活しない。  
  - リスク：旧バージョンの保存データを持つユーザーで再び直下書き出しが発生する。
- **M** Dropzone → OutputPanel 間の payload 伝播（`src/components/Dropzone.tsx:760-820`）  
  - `composeMany`へ渡る `groupByFormat` が常に true か、worker 内で true を前提としているかを担保するテストが必要。
- **M** `FileExportService` / `DirectoryService` とワーカー連携（`src/services/FileExportService.ts`, `src/services/DirectoryService.ts`）  
  - 既存テストは `ensureDirectoryHandle` の成功可否のみ。フォーマット別フォルダを前提としたパス生成が検証されていない。
- **M** PSD レイヤーマスク（`src/worker/psd.ts`）  
  - 次 Issue(H06) を着手する前に既存仕様をテストで固定化しておく必要あり。
- **L** 12 枚超警告・50MB 超拒否など UI バリデーション  
  - ドキュメント化されているがテスト無し。回帰検出コストが高い。

## 4. 推奨アクション / TODO ドラフト
- [x] **Vitest**：`OutputPanel` の `writeFile`/`saveOutput` をモック FS で直叩きするユニットテストを新規追加。  
  - 成功ケース（フォルダ作成＋ルート削除）／ルート削除失敗時の例外握り潰し／`groupByFormat=false`（退避で false を渡した場合の防御）を網羅。
- [x] **Vitest**：`ProfilesContext` 正規化関数を単独テスト化（旧設定から `groupByFormat:false` が除去されるか確認）。  
  - ついでに `fileBase` サニタイズ（`sanitizeFileBase`）の境界ケースを押さえる。
- [x] **Vitest**：`Dropzone` or `composeMany` 近辺の payload テストを追加し、`groupByFormat` が worker へ伝播することを確認。  
  -`src/test/integration.fileSaveFlow.test.ts` にフォルダ分岐を組み込む案でも可。
- [x] **Worker 層テスト**：`src/worker/core.ts` に対して `groupByFormat` 前提でファイルパスを構築するケースをモックして検証。  
  - 現状ユニットテストなしなので、新規に `src/worker/__tests__/core.groupByFormat.test.ts` 等を追加する想定。
- [ ] **PSD ユニットテスト準備**：`psd.ts` のマスク生成ロジックをテスト可能な小関数に切り出し、Vitest で JSON 断面を比較できるようにする。
- [ ] **Playwright TODO**：`tests/visual.spec.ts` を正式な E2E に差し替え、保存先設定 UI と出力結果のフォルダ構成をスクリーンショットで検証。

## 5. メモ
- 現状のテストはサービス層中心で、React コンポーネントやワーカー処理の実データフローが網羅されていない。  
- 次 Issue（H06 以降）に着手する前に、少なくとも上記 High 優先度のテストを整備しておくとリグレッション検出が安定する想定。  
- ドキュメントや TODO リストに転記する際は、本メモの TODO をタスク化してから着手する。
