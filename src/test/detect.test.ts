import { describe, expect, test, vi } from 'vitest';

vi.mock('onnxruntime-web', () => {
  class Tensor {
    type: string;
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }
  class InferenceSession {
    static async create(_path: string) {
      return new InferenceSession();
    }
    inputNames = ['input'];
    outputNames = ['output'];
    async run(_feeds: Record<string, Tensor>) {
      return {
        output: {
          dims: [1, 6, 1],
          data: new Float32Array([320, 320, 64, 128, 0.9, 0.1])
        }
      };
    }
  }
  return { Tensor, InferenceSession };
});

class MockContext {
  imageData: any;
  constructor(public width: number, public height: number) {}
  putImageData(imageData: any) {
    this.imageData = imageData;
  }
  drawImage() {
    this.imageData = { data: new Uint8ClampedArray(640 * 640 * 4) };
  }
  getImageData() {
    return this.imageData;
  }
}
class MockCanvas {
  ctx: MockContext;
  constructor(public width: number, public height: number) {
    this.ctx = new MockContext(width, height);
  }
  getContext() {
    return this.ctx;
  }
}
(globalThis as any).OffscreenCanvas = MockCanvas;

describe('worker detect', () => {
  test('returns expected predictions', async () => {
    const { detect } = await import('../worker/yolo');
    const width = 640;
    const height = 640;
    const imageData = {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height
    } as unknown as ImageData;

    const preds = await detect(imageData);

    expect(preds).toHaveLength(1);
    expect(preds[0]).toMatchObject({
      bbox: [288, 256, 64, 128],
      classId: 0
    });
    expect(preds[0].score).toBeCloseTo(0.9, 5);
  });

  test('applies area filter', async () => {
    const { detect } = await import('../worker/yolo');
    const width = 640;
    const height = 640;
    const imageData = {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    } as unknown as ImageData;

    const preds = await detect(imageData, 0.25, 0.45, { minArea: 10000 });

    expect(preds).toHaveLength(0);
  });
});
