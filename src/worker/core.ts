import { init as initYolo, detect as detectYolo, Prediction } from './yolo';
import { cropAndResize, ResizeSpec } from './opencv';
import { createPsd, PsdLayer } from './psd';

interface InitMessage {
  type: 'init';
}

interface DetectMessage {
  type: 'detect';
  payload: { fileId: string; imageData: ImageData };
}

interface ComposePayload {
  image: ImageBitmap;
  bbox: [number, number, number, number];
  sizes: ResizeSpec[];
  exportPsd?: boolean;
}

interface ComposeMessage {
  type: 'compose';
  payload: ComposePayload;
}

type Message = InitMessage | DetectMessage | ComposeMessage;

self.onmessage = async (e: MessageEvent<Message>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      await initYolo();
      postMessage({ type: 'progress', step: 'init' });
      break;

    case 'detect': {
      const { fileId, imageData } = msg.payload;
      const predictions: Prediction[] = await detectYolo(imageData);
      postMessage({ type: 'progress', step: 'detect', fileId });
      postMessage({ type: 'detect', fileId, predictions });
      break;
    }

    case 'compose': {
      const { image, bbox, sizes, exportPsd } = msg.payload;
      const crops = await cropAndResize(image, bbox, sizes);
      postMessage({ type: 'progress', step: 'opencv' });

      const layers: PsdLayer[] = Object.entries(crops).map(([name, img]) => ({
        name,
        image: img,
      }));

      postMessage({ type: 'progress', step: 'compose' });

      const psd = await createPsd(image.width, image.height, layers, exportPsd);

      postMessage({ type: 'progress', step: 'psd' });
      postMessage({ type: 'compose', images: crops, psd });
      break;
    }
  }
};
