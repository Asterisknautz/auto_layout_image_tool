/**
 * FileSystemDirectoryHandle永続化ユーティリティ
 * IndexedDBを使用してHandleを保存・復元
 */

interface StoredHandle {
  id: string;
  handle: FileSystemDirectoryHandle;
  displayName: string;
  lastUsed: number;
}

const DB_NAME = 'ImageToolHandles';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

class HandleStorage {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  async storeHandle(id: string, handle: FileSystemDirectoryHandle, displayName: string): Promise<void> {
    if (!this.db) await this.init();
    
    const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const storedHandle: StoredHandle = {
      id,
      handle,
      displayName,
      lastUsed: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(storedHandle);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getHandle(id: string): Promise<{ handle: FileSystemDirectoryHandle; displayName: string } | null> {
    if (!this.db) await this.init();
    
    const transaction = this.db!.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const result = request.result as StoredHandle | undefined;
        if (result) {
          resolve({ handle: result.handle, displayName: result.displayName });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async checkPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      // @ts-ignore - queryPermission may not be in all TypeScript definitions
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      return permission === 'granted';
    } catch {
      return false;
    }
  }

  async requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      // @ts-ignore - requestPermission may not be in all TypeScript definitions
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      return permission === 'granted';
    } catch {
      return false;
    }
  }

  async getAllHandles(): Promise<StoredHandle[]> {
    if (!this.db) await this.init();
    
    const transaction = this.db!.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async removeHandle(id: string): Promise<void> {
    if (!this.db) await this.init();
    
    const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const handleStorage = new HandleStorage();