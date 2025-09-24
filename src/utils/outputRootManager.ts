/**
 * 出力ルート管理サービス
 * ユーザー選択した「出力の家」を管理し、プロジェクトごとのサブフォルダを作成
 */

import { handleStorage } from './handleStorage';
import { debugController } from './debugMode';

export interface OutputRootChangeDetail {
  hasRoot: boolean;
  name: string;
}

function emitOutputRootChange(detail: OutputRootChangeDetail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  const CustomEventCtor =
    typeof window.CustomEvent === 'function'
      ? window.CustomEvent
      : typeof globalThis.CustomEvent === 'function'
        ? (globalThis.CustomEvent as typeof window.CustomEvent)
        : undefined;

  if (!CustomEventCtor) {
    return;
  }

  window.dispatchEvent(
    new CustomEventCtor('outputRootChange', { detail }) as CustomEvent<OutputRootChangeDetail>
  );
}

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemDirectoryHandle | string;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
};

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

function getPickerWindow(): DirectoryPickerWindow | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window as DirectoryPickerWindow;
}

const OUTPUT_ROOT_ID = 'output_root';

export class OutputRootManager {
  private outputRoot: FileSystemDirectoryHandle | null = null;
  private outputRootName: string = '';
  private currentProjectHandle: FileSystemDirectoryHandle | null = null;
  private currentProjectName: string = '';

  /**
   * 出力ルートが設定されているかチェック
   */
  async hasOutputRoot(): Promise<boolean> {
    if (this.outputRoot) return true;
    
    const stored = await handleStorage.getHandle(OUTPUT_ROOT_ID);
    if (stored) {
      const hasPermission = await handleStorage.checkPermission(stored.handle);
      if (hasPermission) {
        this.outputRoot = stored.handle;
        this.outputRootName = stored.displayName;
        emitOutputRootChange({ hasRoot: true, name: this.outputRootName });
        return true;
      }
      
      // 権限をリクエスト
      const granted = await handleStorage.requestPermission(stored.handle);
        if (granted) {
          this.outputRoot = stored.handle;
          this.outputRootName = stored.displayName;
          emitOutputRootChange({ hasRoot: true, name: this.outputRootName });
          return true;
      }
    }
    
    return false;
  }

  /**
   * 出力ルートを設定（ユーザー選択）
   */
  async setupOutputRoot(): Promise<{ success: boolean; displayName?: string }> {
    try {
      const pickerWindow = getPickerWindow();
      if (!pickerWindow?.showDirectoryPicker) {
        throw new Error('File System Access API not supported');
      }

      const handle = await pickerWindow.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'desktop'
      });

      await handleStorage.storeHandle(OUTPUT_ROOT_ID, handle, handle.name);
      this.outputRoot = handle;
      this.outputRootName = handle.name;

      debugController.log('OutputRootManager', 'Output root set to:', handle.name);
      emitOutputRootChange({ hasRoot: true, name: this.outputRootName });
      return { success: true, displayName: handle.name };
    } catch (error) {
      debugController.log('OutputRootManager', 'Failed to setup output root:', error);
      return { success: false };
    }
  }

  /**
   * プロジェクトの出力フォルダを取得/作成
   */
  async getProjectOutputHandle(folderName: string): Promise<FileSystemDirectoryHandle | null> {
    if (!await this.hasOutputRoot()) {
      debugController.log('OutputRootManager', 'No output root available');
      return null;
    }

    try {
      debugController.log('OutputRootManager', 'Creating output for folder:', folderName);

      // フォルダを直接作成（_outputサブフォルダは不要）
      const outputHandle = await this.outputRoot!.getDirectoryHandle(folderName, { create: true });
      
      // 既存ファイルを削除（要求仕様）
      await this.clearOutputFolder(outputHandle);
      
      // 現在のプロジェクトハンドルとして記憶
      this.currentProjectHandle = outputHandle;
      this.currentProjectName = folderName;
      
      debugController.log('OutputRootManager', 'Project output handle created:', folderName);
      return outputHandle;
    } catch (error) {
      debugController.log('OutputRootManager', 'Failed to create project output handle:', error);
      return null;
    }
  }

  /**
   * フォルダ内の既存ファイルを削除
   */
  private async clearOutputFolder(outputHandle: FileSystemDirectoryHandle): Promise<void> {
    try {
      const handleWithEntries = outputHandle as DirectoryHandleWithEntries;
      const iterator = handleWithEntries.entries?.();
      if (!iterator) {
        return;
      }
      for await (const [name, entryHandle] of iterator) {
        if (entryHandle.kind === 'file') {
          await outputHandle.removeEntry(name);
          debugController.log('OutputRootManager', 'Removed existing file:', name);
        }
      }
    } catch (error) {
      debugController.log('OutputRootManager', 'Failed to clear folder:', error);
    }
  }

  /**
   * 現在の出力ルート情報を取得
   */
  getOutputRootInfo(): { name: string; handle: FileSystemDirectoryHandle | null } {
    return {
      name: this.outputRootName,
      handle: this.outputRoot
    };
  }

  /**
   * 現在のプロジェクトハンドルを取得
   */
  getCurrentProjectHandle(): FileSystemDirectoryHandle | null {
    return this.currentProjectHandle;
  }

  /**
   * 現在のプロジェクト情報を取得
   */
  getCurrentProjectInfo(): { name: string; handle: FileSystemDirectoryHandle | null } {
    return {
      name: this.currentProjectName,
      handle: this.currentProjectHandle
    };
  }

  /**
   * 出力ルートをリセット
   */
  async resetOutputRoot(): Promise<void> {
    await handleStorage.removeHandle(OUTPUT_ROOT_ID);
    this.outputRoot = null;
    this.outputRootName = '';
    this.currentProjectHandle = null;
    this.currentProjectName = '';
    debugController.log('OutputRootManager', 'Output root reset');
    emitOutputRootChange({ hasRoot: false, name: '' });
  }
}

export const outputRootManager = new OutputRootManager();

declare global {
  interface WindowEventMap {
    outputRootChange: CustomEvent<OutputRootChangeDetail>;
  }
}
