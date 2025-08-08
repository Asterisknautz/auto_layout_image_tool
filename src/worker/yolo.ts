import * as ort from 'onnxruntime-web';

export interface Prediction {
  bbox: [number, number, number, number];
  classId: number;
  score: number;
}

let session: ort.InferenceSession | null = null;
let initFailed = false;

/**
 * Preload YOLO model and keep session singleton
 */
export async function init(modelPath?: string) {
  if (session || initFailed) return;
  const base = (import.meta as any).env?.BASE_URL ?? '/';
  
  // Configure ONNX Runtime
  try {
    ort.env.wasm.wasmPaths = `${base}node_modules/onnxruntime-web/dist/`;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
  } catch (e) {
    console.warn('[YOLO] WASM path configuration failed:', e);
  }
  
  const resolved = modelPath ?? `${base}models/yolov8n.onnx`;
  try {
    session = await ort.InferenceSession.create(resolved, {
      executionProviders: ['wasm'],
      enableCpuMemArena: false,
    });
  } catch (e) {
    console.warn('[YOLO] Failed to load model:', e);
    initFailed = true;
  }
}

/**
 * Run YOLO detection on ImageData
 */
export interface DetectFilters {
  /** filter out boxes with area smaller than this (px^2) */
  minArea?: number;
  /** reject boxes with aspect ratio < minAspectRatio */
  minAspectRatio?: number;
  /** reject boxes with aspect ratio > maxAspectRatio */
  maxAspectRatio?: number;
}

export async function detect(
  imageData: ImageData,
  conf = 0.25,
  iou = 0.45,
  filters: DetectFilters = {}
): Promise<Prediction[]> {
  if (!session && !initFailed) {
    await init();
  }
  if (!session) {
    // Model unavailable: return no predictions safely
    return [];
  }
  const size = 640;
  const { width, height } = imageData;

  // resize ImageData to model size
  const srcCanvas = new OffscreenCanvas(width, height);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(imageData, 0, 0);
  const dstCanvas = new OffscreenCanvas(size, size);
  const dstCtx = dstCanvas.getContext('2d')!;
  dstCtx.drawImage(srcCanvas, 0, 0, width, height, 0, 0, size, size);
  const resized = dstCtx.getImageData(0, 0, size, size).data;

  const floatData = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) {
    floatData[i] = resized[i * 4] / 255;
    floatData[i + size * size] = resized[i * 4 + 1] / 255;
    floatData[i + 2 * size * size] = resized[i * 4 + 2] / 255;
  }

  const tensor = new ort.Tensor('float32', floatData, [1, 3, size, size]);
  const feeds: Record<string, ort.Tensor> = {
    [session!.inputNames[0]]: tensor,
  };
  let results: Record<string, ort.Tensor>;
  try {
    results = await session!.run(feeds);
  } catch (e) {
    console.warn('[YOLO] Inference failed:', e);
    return [];
  }
  const output = results[session!.outputNames[0]];

  const numAnchors = output.dims[2];
  const numClasses = output.dims[1] - 4;
  const data = output.data as Float32Array;

  const boxes: Array<[number, number, number, number]> = [];
  const scores: number[] = [];
  const classIds: number[] = [];

  for (let i = 0; i < numAnchors; i++) {
    let maxScore = -Infinity;
    let classId = -1;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numAnchors + i];
      if (score > maxScore) {
        maxScore = score;
        classId = c;
      }
    }
    if (maxScore > conf) {
      const x = data[0 * numAnchors + i];
      const y = data[1 * numAnchors + i];
      const w = data[2 * numAnchors + i];
      const h = data[3 * numAnchors + i];
      const xScaled = (x / size) * width;
      const yScaled = (y / size) * height;
      const wScaled = (w / size) * width;
      const hScaled = (h / size) * height;
      boxes.push([xScaled - wScaled / 2, yScaled - hScaled / 2, wScaled, hScaled]);
      scores.push(maxScore);
      classIds.push(classId);
    }
  }

  const selected = nms(boxes, scores, iou);
  const preds: Prediction[] = [];
  const {
    minArea = 1000,
    minAspectRatio = 0.25,
    maxAspectRatio = 4,
  } = filters;
  for (const idx of selected) {
    const [x, y, w, h] = boxes[idx];
    const area = w * h;
    const ar = w / h;
    if (area < minArea) continue;
    if (ar < minAspectRatio || ar > maxAspectRatio) continue;
    preds.push({ bbox: [x, y, w, h], score: scores[idx], classId: classIds[idx] });
  }
  return preds;
}

function nms(
  boxes: Array<[number, number, number, number]>,
  scores: number[],
  threshold: number
): number[] {
  const idxs = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .map((o) => o.i);
  const selected: number[] = [];
  while (idxs.length > 0) {
    const current = idxs.shift()!;
    selected.push(current);
    for (let i = idxs.length - 1; i >= 0; i--) {
      if (bboxIou(boxes[current], boxes[idxs[i]]) >= threshold) {
        idxs.splice(i, 1);
      }
    }
  }
  return selected;
}

function bboxIou(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union === 0 ? 0 : inter / union;
}
