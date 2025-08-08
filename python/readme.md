# Batch Image Crop/Resize & Layout (Python)

Python 版の一括トリミング・リサイズと複数画像レイアウト合成ツールです。単体画像はクロップ→リサイズ、サブフォルダ内の複数画像はキャンバスに整列して1枚に合成します。

## セットアップ
- 要件: Python 3.9+。
- インストール: `pip install pillow opencv-python ultralytics tqdm`
- 実行ディレクトリはリポジトリルート推奨（`yolov8n.pt` を相対参照）。YOLO が未インストールの場合は中央スクエアでクロップします。

## 使い方
- デフォルト実行（`output_profiles.json`, `input/`, `output/` を使用）
  - `python python/batch_resize.py`
- 主なオプション
  - `--cfg <json>` 出力・レイアウト設定（既定: `python/output_profiles.json` ではなくスクリプト既定はルートを想定するため、必要に応じてフルパスを指定）
  - `--input-dir <dir>` 入力ルート（既定: `input`）
  - `--out-dir <dir>` 出力ルート（既定: `output`）
  - `--pad <px>` 余白（既定: 40）
  - `--conf`, `--iou-thres` YOLO スコア/IoU（0–1）
  - `--min-area`, `--max-area` 検出領域フィルタ（px^2）
  - `--debug` 検出枠デバッグ画像を出力

例:
```
python python/batch_resize.py \
  --cfg python/output_profiles.json \
  --input-dir input --out-dir output \
  --pad 50 --conf 0.9 --iou-thres 0.3 --min-area 5000 --max-area 200000 --debug
```

## 入出力と命名
- 入力: `input/` 直下の画像は単体処理、`input/<任意フォルダ>/` は合成モード。
- 出力: `output/<tag>/` に保存。
- 生成ファイル名: `<元名>_<tag><width>x<height>.<ext>`（例: `IMG_001_sp_750x900.jpg`）。
- デバッグ画像: `output/debug_<元名>.jpg`。

## 設定ファイル（output_profiles.json）
- `outputs.profiles[]`: 出力プロフィール。`tag`, `size`（例: "750x900"）, 任意 `pad`。
- `layouts`: 合成モードの行構成（`vertical`/`horizontal`/`square`）。`patterns[枚数].rows` で行ごとのカラム数を指定。

## 注意点
- YOLO 使用時は `yolov8n.pt` の存在が必要。未導入なら自動的に中央トリミングにフォールバック。
- 大量画像処理では I/O が支配的です。SSD を推奨し、必要に応じて `--max-area` などで負荷を調整してください。
