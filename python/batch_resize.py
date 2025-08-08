#!/usr/bin/env python3
"""
Batch image crop-&-resize & composition utility
===============================================

* 入力フォルダ直下の画像ファイルはバッチクロップ＆リサイズ
* 入力フォルダ直下のサブフォルダは複数画像を1枚にレイアウト

Usage:
------
# デフォルト実行 (output_profiles.json, input/, output/ 使用)
$ python batch_resize.py

# オプション指定
$ python batch_resize.py \
    --cfg custom_profiles.json \
    --input-dir photos \
    --out-dir results \
    --pad 50 --conf 0.9 --iou-thres 0.3 --min-area 5000 --max-area 200000 --debug

Dependencies:
------------
$ pip install pillow opencv-python ultralytics tqdm
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance, ImageStat, ImageDraw
from tqdm import tqdm

# Optional YOLO
try:
    from ultralytics import YOLO
    _YOLO = True
except ImportError:
    _YOLO = False

# --- CLI ---
def parse_args():
    p = argparse.ArgumentParser("Batch crop/resize & compose")
    p.add_argument("--cfg", default="output_profiles.json",
                   help="JSON config with outputs/layouts (default: output_profiles.json)")
    p.add_argument("--input-dir", default="input",
                   help="Input root directory (default: input)")
    p.add_argument("--out-dir", default="output",
                   help="Output root directory (default: output)")
    p.add_argument("--pad", type=int, default=40, help="Default pad px")
    p.add_argument("--conf", type=float, default=1.0, help="YOLO confidence 0-1")
    p.add_argument("--iou-thres", type=float, default=0.45, help="YOLO NMS IoU 0-1")
    p.add_argument("--min-area", type=int, default=0, help="Min bbox area")
    p.add_argument("--max-area", type=int, default=None, help="Max bbox area")
    p.add_argument("--debug", action="store_true", help="Draw bbox debug images")
    return p.parse_args()

# --- load config ---
def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)

# --- YOLO bbox retrieval ---
def get_bbox_yolo(model: YOLO, img_path: str, conf: float, iou: float) -> tuple[int,int,int,int] | None:
    res = model(img_path, imgsz=640, conf=conf, iou=iou, verbose=False)[0]
    if not res.boxes: return None
    boxes = res.boxes.xyxy.cpu().numpy()
    areas = (boxes[:,2]-boxes[:,0])*(boxes[:,3]-boxes[:,1])
    idx = areas.argmax()
    return tuple(map(int, boxes[idx]))

# --- helpers ---
def center_square(w: int, h: int, pad: int) -> tuple[int,int,int,int]:
    side = min(w, h) - 2*pad
    l = (w-side)//2; t = (h-side)//2
    return l, t, l+side, t+side


def expand_aspect(l: int, t: int, r: int, b: int, ratio: float, w: int, h: int, pad: int) -> tuple[int,int,int,int]:
    bw, bh = r-l, b-t; cr = bw/bh
    if cr < ratio:
        nw = int(bh*ratio); d = (nw-bw)//2; l -= d; r += d
    else:
        nh = int(bw/ratio); d = (nh-bh)//2; t -= d; b += d
    l -= pad; t -= pad; r += pad; b += pad
    return max(l,0), max(t,0), min(r,w), min(b,h)


def resize_and_save(im: Image.Image, dst: Path, name: str, ext: str, sep: str, tag: str, tw: int, th: int, quality: int):
    im = im.resize((tw, th), Image.Resampling.LANCZOS)
    dst.mkdir(parents=True, exist_ok=True)
    fname = f"{name}{sep}{tag}{tw}x{th}{ext}"
    im.save(dst/fname, quality=quality)

# --- Single image batch mode ---
def run_batch(args, cfg, files: list[Path]):
    out_cfg = cfg["outputs"]
    profiles = out_cfg["profiles"]
    sep = out_cfg.get("separator", "_")
    default_pad = out_cfg.get("default_pad", args.pad)
    out_root = Path(args.out_dir)
    model = YOLO("yolov8n.pt") if _YOLO else None

    for src in tqdm(files, desc="batch"):
        im = Image.open(src);
        w, h = im.size
        bbox = get_bbox_yolo(model, str(src), args.conf, args.iou_thres) if model else None
        if not bbox:
            bbox = center_square(w, h, args.pad)
        l0, t0, r0, b0 = bbox;
        area = (r0-l0)*(b0-t0)
        if area < args.min_area or (args.max_area and area > args.max_area):
            bbox = center_square(w, h, args.pad)
        if args.debug:
            draw = ImageDraw.Draw(im); draw.rectangle(bbox, outline="red", width=3)
            debug_path = Path(args.out_dir)/f"debug_{src.stem}.jpg"; im.save(debug_path)
        stem, ext = src.stem, src.suffix
        for prof in profiles:
            pad = prof.get("pad", default_pad)
            tag = prof["tag"];
            tw, th = map(int, prof["size"].split("x")); ratio = tw/th
            l, t, r, b = expand_aspect(*bbox, ratio, w, h, pad)
            crop = im.crop((l, t, r, b))
            crop = ImageOps.fit(crop, (tw, th), method=Image.Resampling.LANCZOS)
            resize_and_save(crop, out_root/ tag, stem, ext, sep, tag, tw, th, args.pad)

# --- Compose mode ---
def run_compose(args, cfg, folder: Path):
    """
    フォルダ内の画像を outputs.profiles の各定義に従ってレイアウト合成
    """
    out_cfg  = cfg["outputs"]
    sep      = out_cfg.get("separator", "_")
    profiles = out_cfg["profiles"]
    layouts  = cfg["layouts"]
    out_root = Path(args.out_dir)

    imgs = sorted(folder.glob("*.jpg"))
    n    = len(imgs)
    if n == 0:
        return

    for prof in profiles:
        tag       = prof["tag"]
        cw, ch    = map(int, prof["size"].split("x"))

        # 縦横正方の判定
        if   ch > cw: orient = "vertical"
        elif cw > ch: orient = "horizontal"
        else:          orient = "square"

        layout_cfg = layouts[orient]
        gutter     = layout_cfg.get("gutter", 0)
        bg         = layout_cfg.get("bg_color", "#000000")
        rows       = layout_cfg["patterns"][str(n)]["rows"]

        # ← ここを修正：tag フォルダを作る
        compose_dir = out_root / tag
        compose_dir.mkdir(parents=True, exist_ok=True)

        # キャンバス作成
        canvas = Image.new("RGB", (cw, ch), color=bg)
        y = 0; idx = 0
        for rcount in rows:
            rh      = (ch - gutter*(len(rows)-1)) // len(rows)
            cw_cell = (cw - gutter*(rcount-1)) // rcount
            for col in range(rcount):
                im = ImageOps.fit(
                    Image.open(imgs[idx]),
                    (cw_cell, rh),
                    method=Image.Resampling.LANCZOS
                )
                x = col * (cw_cell + gutter)
                canvas.paste(im, (x, y))
                idx += 1
            y += rh + gutter

        # ファイル名に tag とサイズを含めて保存
        out_name = f"{folder.name}_{tag}{sep}{cw}x{ch}.jpg"
        canvas.save(compose_dir / out_name, quality=95)

# --- Main ---
def process(args):
    """Execute batch resize/compose using an argparse-style args object."""
    cfg = load_config(args.cfg)
    input_root = Path(args.input_dir)
    single = []
    folders = []
    for item in input_root.iterdir():
        if item.is_dir():
            folders.append(item)
        elif item.is_file() and item.suffix.lower() in [".jpg", ".jpeg", ".png"]:
            single.append(item)
    if single:
        run_batch(args, cfg, single)
    for folder in folders:
        run_compose(args, cfg, folder)


def main():
    process(parse_args())


if __name__ == "__main__":
    main()
