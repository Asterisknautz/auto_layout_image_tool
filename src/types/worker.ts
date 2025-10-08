import type { Prediction } from '../worker/yolo';
import type { LayoutsConfig, ProfileDef, ComposeGroup } from '../worker/core';

export type WorkerProgressStep = 'init' | 'detect' | 'opencv' | 'canvas-fallback' | 'compose' | 'psd';

export interface WorkerProgressMessage {
  type: 'progress';
  step: WorkerProgressStep;
  fileId?: string;
}

export interface WorkerDetectMessage {
  type: 'detect';
  fileId?: string;
  predictions: Prediction[];
}

export interface WorkerComposeMessage {
  type: 'compose';
  images: Record<string, ImageBitmap>;
  psd?: Blob;
  source?: string;
}

export interface WorkerComposeManyOutput {
  filename: string;
  image: ImageBitmap;
  psd?: Blob;
  png?: Blob;
  formats?: string[];
  groupByFormat?: boolean;
}

export interface WorkerComposeManyMessage {
  type: 'composeMany';
  outputs: WorkerComposeManyOutput[];
  source?: string;
}

export interface WorkerErrorMessage {
  type: 'error';
  error: string;
  source?: string;
}

export type WorkerResponseMessage =
  | WorkerProgressMessage
  | WorkerDetectMessage
  | WorkerComposeMessage
  | WorkerComposeManyMessage
  | WorkerErrorMessage;

export interface ComposeManyRequestDetail {
  groups: ComposeGroup[];
  profiles: ProfileDef[];
  layouts?: LayoutsConfig;
}

export interface AutoSaveSetupDetail {
  displayName: string;
  outputHandle: FileSystemDirectoryHandle;
}

export interface AutoSaveRequestDetail {
  images: Record<string, ImageBitmap>;
  psd?: Blob;
  source?: string;
}

export type WorkerMessageEvent = MessageEvent<WorkerResponseMessage>;
