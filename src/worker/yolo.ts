import * as ort from 'onnxruntime-web';

export interface Prediction {
  bbox: [number, number, number, number];
  classId: number;
  score: number;
}

let session: ort.InferenceSession | null = null;

/**
 * Preload YOLO model and keep session singleton
 */
export async function init(modelPath = '/models/yolov8n.onnx') {
  if (!session) {
    session = await ort.InferenceSession.create(modelPath);
  }
}

/**
 * Run YOLO detection on ImageData
 */
export async function detect(
  imageData: ImageData,
  conf = 0.25,
  iou = 0.45
): Promise<Prediction[]> {
  if (!session) {
    await init();
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
  const results = await session!.run(feeds);
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
  const MIN_AREA = 1000; // min_area filter
  const MIN_AR = 0.25; // min aspect ratio
  const MAX_AR = 4; // max aspect ratio
  for (const idx of selected) {
    const [x, y, w, h] = boxes[idx];
    const area = w * h;
    const ar = w / h;
    if (area < MIN_AREA) continue;
    if (ar < MIN_AR || ar > MAX_AR) continue;
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
    idxs = idxs.filter((i) => bboxIou(boxes[current], boxes[i]) < threshold);
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
