import type { AutoSaveRequestDetail, AutoSaveSetupDetail, ComposeManyRequestDetail } from './worker';

export {};

declare global {
  interface Window {
    autoSaveHandle?: FileSystemDirectoryHandle | null;
    clearCache?: () => void;
    resetApp?: () => void;
  }

  interface DataTransferItem {
    webkitGetAsEntry?: () => FileSystemEntry | null;
  }

  interface FileSystemEntry {
    readonly isFile: boolean;
    readonly isDirectory: boolean;
    readonly name: string;
    readonly fullPath?: string;
  }

  interface FileSystemFileEntry extends FileSystemEntry {
    file(callback: (file: File) => void): void;
  }

  interface FileSystemDirectoryReader {
    readEntries(successCallback: (entries: FileSystemEntry[]) => void): void;
  }

  interface FileSystemDirectoryEntry extends FileSystemEntry {
    createReader(): FileSystemDirectoryReader;
  }

  interface WindowEventMap {
    autoSaveSetup: CustomEvent<AutoSaveSetupDetail>;
    autoSaveRequest: CustomEvent<AutoSaveRequestDetail>;
    composeManyRequest: CustomEvent<ComposeManyRequestDetail>;
  }

  interface HTMLInputElement {
    webkitdirectory?: boolean;
    directory?: boolean;
  }
}
