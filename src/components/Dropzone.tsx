import { useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';

/**
 * Dropzone component that accepts a single image file and sends it to the worker
 * for object detection.
 */
export default function Dropzone() {
  // create worker once
  const worker = useMemo(
    () => new Worker(new URL('../worker/core.ts', import.meta.url), { type: 'module' }),
    []
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];
      const bitmap = await createImageBitmap(file);

      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const fileId = crypto.randomUUID();
      worker.postMessage({ type: 'detect', payload: { fileId, imageData } });
    },
    [worker]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div
      {...getRootProps()}
      style={{ border: '2px dashed #888', padding: '20px', textAlign: 'center' }}
    >
      <input {...getInputProps()} />
      {isDragActive ? (
        <p>Drop the image here ...</p>
      ) : (
        <p>Drag 'n' drop an image file here, or click to select.</p>
      )}
    </div>
  );
}
