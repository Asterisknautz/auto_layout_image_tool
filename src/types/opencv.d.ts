declare module 'opencv.js' {
  export class Mat {
    readonly cols: number;
    readonly rows: number;
    readonly data: Uint8Array | Uint8ClampedArray;
    constructor(...args: unknown[]);
    roi(rect: Rect): Mat;
    copyTo(mat: Mat): void;
    setTo(scalar: Scalar): void;
    delete(): void;
  }

  export class Rect {
    constructor(x: number, y: number, width: number, height: number);
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }

  export class Size {
    constructor(width: number, height: number);
    readonly width: number;
    readonly height: number;
  }

  export class Scalar {
    constructor(v0: number, v1: number, v2: number, v3: number);
  }

  export interface CvInterface {
    readonly Mat: typeof Mat;
    readonly Rect: typeof Rect;
    readonly Size: typeof Size;
    readonly Scalar: typeof Scalar;
    readonly CV_8UC4: number;
    readonly INTER_AREA: number;
    matFromImageData(data: ImageData): Mat;
    resize(src: Mat, dst: Mat, dsize: Size, fx: number, fy: number, interpolation: number): void;
  }

  const cv: CvInterface;
  export default cv;
}
