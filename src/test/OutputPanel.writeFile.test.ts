import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MutableRefObject } from 'react';
import { createWriteFile, createSaveOutput } from '../components/OutputPanel';
import {
  createDirectoryHandleMock,
  createFileHandleMock,
  ensureWindow,
  type DirectoryHandleMock,
} from './utils/mockFileSystem';

vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn(),
  },
}));

const createDirRef = (handle: DirectoryHandleMock | null): MutableRefObject<FileSystemDirectoryHandle | null> => ({
  current: handle,
});

describe('OutputPanel writeFile helpers', () => {
  const blob = new Blob(['test']);
  const debug = { log: vi.fn() };
  const win = ensureWindow();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes into extension folder and removes root-level duplicate when grouping', async () => {
    const projectHandle = createDirectoryHandleMock('project', {
      removeEntry: vi.fn().mockResolvedValue(undefined),
    });
    const extensionHandle = createDirectoryHandleMock('jpg');
    const { handle: fileHandle, writable } = createFileHandleMock('group_profile.jpg');

    projectHandle.getDirectoryHandle.mockResolvedValue(extensionHandle);
    extensionHandle.getFileHandle.mockResolvedValue(fileHandle);

    const dirRef = createDirRef(projectHandle);
    const ensureDirectoryHandle = vi.fn().mockResolvedValue(true);

    const writeFile = createWriteFile({
      autoSave: true,
      ensureDirectoryHandle,
      dirHandleRef: dirRef,
      debug,
      globalWindow: win,
    });

    const result = await writeFile('group_profile.jpg', blob, {
      ext: 'jpg',
      groupByFormat: true,
    });

    expect(result).toBe(true);
    expect(ensureDirectoryHandle).toHaveBeenCalledTimes(1);
    expect(projectHandle.getDirectoryHandle).toHaveBeenCalledWith('jpg', { create: true });
    expect(extensionHandle.getFileHandle).toHaveBeenCalledWith('group_profile.jpg', { create: true });
    expect(fileHandle.createWritable).toHaveBeenCalled();
    expect(writable.write).toHaveBeenCalledWith(blob);
    expect(projectHandle.removeEntry).toHaveBeenCalledWith('group_profile.jpg');
  });

  it('does not create extension folder when grouping disabled', async () => {
    const projectHandle = createDirectoryHandleMock('project', {
      removeEntry: vi.fn().mockResolvedValue(undefined),
    });
    const { handle: fileHandle } = createFileHandleMock('plain.jpg');
    projectHandle.getFileHandle.mockResolvedValue(fileHandle);

    const dirRef = createDirRef(projectHandle);
    const ensureDirectoryHandle = vi.fn().mockResolvedValue(true);

    const writeFile = createWriteFile({
      autoSave: true,
      ensureDirectoryHandle,
      dirHandleRef: dirRef,
      debug,
      globalWindow: win,
    });

    const result = await writeFile('plain.jpg', blob, {
      ext: 'jpg',
      groupByFormat: false,
    });

    expect(result).toBe(true);
    expect(projectHandle.getDirectoryHandle).not.toHaveBeenCalled();
    expect(projectHandle.removeEntry).not.toHaveBeenCalled();
    expect(projectHandle.getFileHandle).toHaveBeenCalledWith('plain.jpg', { create: true });
  });

  it('returns false when filename resolves to empty segments', async () => {
    const projectHandle = createDirectoryHandleMock('project');
    const dirRef = createDirRef(projectHandle);
    const ensureDirectoryHandle = vi.fn().mockResolvedValue(true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const writeFile = createWriteFile({
      autoSave: true,
      ensureDirectoryHandle,
      dirHandleRef: dirRef,
      debug,
      globalWindow: win,
    });

    const result = await writeFile('   ', blob);

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith('[OutputPanel] Invalid filename provided:', '   ');
    warnSpy.mockRestore();
  });

  it('skips writing when autoSave is disabled', async () => {
    const projectHandle = createDirectoryHandleMock('project');
    const dirRef = createDirRef(projectHandle);
    const ensureDirectoryHandle = vi.fn();

    const writeFile = createWriteFile({
      autoSave: false,
      ensureDirectoryHandle,
      dirHandleRef: dirRef,
      debug,
      globalWindow: win,
    });

    const result = await writeFile('ignored.jpg', blob, {
      ext: 'jpg',
      groupByFormat: true,
    });

    expect(result).toBe(false);
    expect(ensureDirectoryHandle).not.toHaveBeenCalled();
  });

  it('returns false when ensureDirectoryHandle fails', async () => {
    const projectHandle = createDirectoryHandleMock('project');
    const dirRef = createDirRef(projectHandle);
    const ensureDirectoryHandle = vi.fn().mockResolvedValue(false);

    const writeFile = createWriteFile({
      autoSave: true,
      ensureDirectoryHandle,
      dirHandleRef: dirRef,
      debug,
      globalWindow: win,
    });

    const result = await writeFile('failed.jpg', blob, {
      ext: 'jpg',
      groupByFormat: true,
    });

    expect(result).toBe(false);
    expect(ensureDirectoryHandle).toHaveBeenCalledTimes(1);
  });
});

describe('OutputPanel saveOutput helper', () => {
  const blob = new Blob(['data']);

  it('normalizes extension and defaults groupByFormat to true', async () => {
    const writeFile = vi.fn().mockResolvedValue(true);
    const saveOutput = createSaveOutput(writeFile);

    const result = await saveOutput('product', 'JPG', blob);

    expect(result).toBe(true);
    expect(writeFile).toHaveBeenCalledWith('product.jpg', blob, {
      ext: 'jpg',
      groupByFormat: true,
    });
  });

  it('allows overriding groupByFormat flag', async () => {
    const writeFile = vi.fn().mockResolvedValue(true);
    const saveOutput = createSaveOutput(writeFile);

    await saveOutput('product', 'png', blob, false);

    expect(writeFile).toHaveBeenCalledWith('product.png', blob, {
      ext: 'png',
      groupByFormat: false,
    });
  });
});
