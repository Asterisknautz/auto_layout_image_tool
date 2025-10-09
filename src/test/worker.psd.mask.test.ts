import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const writePsdMock = vi.fn(() => new Uint8Array());
const initializeCanvasMock = vi.fn();

vi.mock('ag-psd', () => ({
  writePsd: writePsdMock,
  initializeCanvas: initializeCanvasMock
}));

class FakeRenderingContext2D {
  fillStyle = '#000000';
  clearRect() {
    // no-op
  }
  fillRect() {
    // no-op
  }
  drawImage() {
    // no-op
  }
  beginPath() {
    // no-op
  }
  rect() {
    // no-op
  }
  clip() {
    // no-op
  }
  save() {
    // no-op
  }
  restore() {
    // no-op
  }
}

class FakeOffscreenCanvas {
  private readonly context: FakeRenderingContext2D;
  constructor(public width: number, public height: number) {
    this.context = new FakeRenderingContext2D();
  }
  getContext() {
    return this.context;
  }
  transferToImageBitmap() {
    return { width: this.width, height: this.height } as ImageBitmap;
  }
}

let createPsd: typeof import('../worker/psd').createPsd;

beforeAll(async () => {
  if (typeof self === 'undefined') {
    vi.stubGlobal('self', {
      onmessage: null,
      postMessage: vi.fn()
    });
  } else {
    Object.assign(self, {
      onmessage: null,
      postMessage: vi.fn()
    });
  }

  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas as unknown as typeof OffscreenCanvas);

  const module = await import('../worker/psd');
  createPsd = module.createPsd;
});

beforeEach(() => {
  writePsdMock.mockClear();
  initializeCanvasMock.mockClear();
});

describe('createPsd layer mask support', () => {
  it('passes mask metadata through to ag-psd', async () => {
    const imageBitmap = { width: 450, height: 300 } as ImageBitmap;
    const maskCanvas = new OffscreenCanvas(800, 600);

    const blob = await createPsd(
      800,
      600,
      [
        {
          name: 'sample.jpg',
          image: imageBitmap,
          left: 75,
          top: 50,
          visibleRect: {
            left: 100,
            top: 50,
            width: 300,
            height: 200
          },
          mask: {
            top: 0,
            left: 0,
            bottom: 600,
            right: 800,
            defaultColor: 0,
            positionRelativeToLayer: false,
            canvas: maskCanvas as unknown as OffscreenCanvas
          }
        }
      ],
      true
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(writePsdMock).toHaveBeenCalledTimes(1);

    const callArgs = writePsdMock.mock.calls[0][0];
    expect(callArgs.children).toHaveLength(2);

    const layer = callArgs.children?.[1];
    expect(layer?.name).toBe('sample.jpg');
    expect(layer?.mask).toBeDefined();
    expect(layer?.visibleRect).toEqual({
      left: 100,
      top: 50,
      width: 300,
      height: 200
    });
    expect(layer?.mask?.positionRelativeToLayer).toBe(false);
    expect(layer?.mask?.defaultColor).toBe(0);
    expect(layer?.mask?.canvas).toBe(maskCanvas);
  });

  it('skips PSD generation when export flag is false', async () => {
    const result = await createPsd(800, 600, [], false);
    expect(result).toBeNull();
    expect(writePsdMock).not.toHaveBeenCalled();
  });
});
