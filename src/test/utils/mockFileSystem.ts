import { vi } from 'vitest';

export type WritableStreamMock = {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

export const createWritableStreamMock = (
  overrides: Partial<WritableStreamMock> = {}
): WritableStreamMock => ({
  write: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  ...overrides
});

export const createAsyncIterator = <T>(items: T[]): AsyncIterableIterator<T> => {
  let index = 0;
  return {
    async next() {
      if (index < items.length) {
        const value = items[index];
        index += 1;
        return { value, done: false };
      }
      return { value: undefined, done: true };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  } as AsyncIterableIterator<T>;
};

export type FileHandleMock = FileSystemFileHandle & {
  name: string;
  kind: 'file';
  createWritable: ReturnType<typeof vi.fn>;
};

export const createFileHandleMock = (
  name: string,
  options: {
    writable?: WritableStreamMock;
  } = {},
  overrides: Partial<FileHandleMock> = {}
) => {
  const writable = options.writable ?? createWritableStreamMock();

  const handle = {
    name,
    kind: 'file' as const,
    createWritable: vi.fn().mockResolvedValue(writable),
    ...overrides
  } as unknown as FileHandleMock;

  return { handle, writable };
};

export type DirectoryHandleMock = FileSystemDirectoryHandle & {
  name: string;
  kind: 'directory';
  getDirectoryHandle: ReturnType<typeof vi.fn>;
  getFileHandle: ReturnType<typeof vi.fn>;
  removeEntry: ReturnType<typeof vi.fn>;
  entries: ReturnType<typeof vi.fn>;
  queryPermission: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
};

export const createDirectoryHandleMock = (
  name: string,
  overrides: Partial<DirectoryHandleMock> = {}
): DirectoryHandleMock => {
  const base = {
    name,
    kind: 'directory' as const,
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(),
    removeEntry: vi.fn(),
    entries: vi.fn().mockReturnValue(createAsyncIterator<[string, FileSystemHandle]>([])),
    queryPermission: vi.fn().mockResolvedValue('granted' as PermissionState),
    requestPermission: vi.fn().mockResolvedValue('granted' as PermissionState),
  };

  return { ...base, ...overrides } as unknown as DirectoryHandleMock;
};

export const ensureWindow = <T extends object = object>() => {
  if (typeof window === 'undefined') {
    vi.stubGlobal('window', {} as typeof window);
  }
  return window as typeof window & T;
};
