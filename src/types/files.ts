export type FileWithDirectory = File & {
  path?: string;
  webkitRelativePath?: string;
};

export type DirectoryEntry = FileSystemDirectoryEntry;
export type DirectoryReader = FileSystemDirectoryReader;
export type FileEntry = FileSystemFileEntry;
export type AnyFileSystemEntry = FileSystemEntry;
