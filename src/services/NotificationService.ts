import { debugController } from '../utils/debugMode';

export interface NotificationOptions {
  type?: 'success' | 'info' | 'warning' | 'error';
  duration?: number;
  persistent?: boolean;
}

export interface INotificationService {
  show(message: string, options?: NotificationOptions): void;
  showSuccess(message: string, options?: Omit<NotificationOptions, 'type'>): void;
  showError(message: string, options?: Omit<NotificationOptions, 'type'>): void;
  showInfo(message: string, options?: Omit<NotificationOptions, 'type'>): void;
  showWarning(message: string, options?: Omit<NotificationOptions, 'type'>): void;
}

export type NotificationCallback = (message: string, type?: string) => void;

export class NotificationService implements INotificationService {
  private callback: NotificationCallback | null = null;

  constructor(callback?: NotificationCallback) {
    this.callback = callback || null;
  }

  /**
   * Set the notification callback function
   */
  setCallback(callback: NotificationCallback): void {
    this.callback = callback;
    debugController.log('NotificationService', 'Notification callback set');
  }

  /**
   * Show a notification with custom options
   */
  show(message: string, options: NotificationOptions = {}): void {
    const { type = 'info', duration = 3000, persistent = false } = options;
    
    debugController.log('NotificationService', 'Showing notification:', {
      message,
      type,
      duration,
      persistent
    });

    if (!this.callback) {
      console.warn('[NotificationService] No callback set, falling back to console');
      console.log(`[${type.toUpperCase()}] ${message}`);
      return;
    }

    this.callback(message, type);
  }

  /**
   * Show success notification
   */
  showSuccess(message: string, options: Omit<NotificationOptions, 'type'> = {}): void {
    this.show(message, { ...options, type: 'success' });
  }

  /**
   * Show error notification
   */
  showError(message: string, options: Omit<NotificationOptions, 'type'> = {}): void {
    this.show(message, { ...options, type: 'error', persistent: true });
  }

  /**
   * Show info notification
   */
  showInfo(message: string, options: Omit<NotificationOptions, 'type'> = {}): void {
    this.show(message, { ...options, type: 'info' });
  }

  /**
   * Show warning notification
   */
  showWarning(message: string, options: Omit<NotificationOptions, 'type'> = {}): void {
    this.show(message, { ...options, type: 'warning' });
  }

  /**
   * Create file export notifications based on results
   */
  showExportResult(
    success: boolean, 
    fileCount: number, 
    profileName?: string, 
    errors?: string[]
  ): void {
    if (success) {
      const message = profileName 
        ? `${profileName}プロファイル：${fileCount}個のファイルを書き出しました`
        : `${fileCount}個のファイルを書き出しました`;
      
      this.showSuccess(message);
    } else {
      const errorMessage = errors?.length 
        ? `書き出しに失敗しました: ${errors[0]}`
        : 'ファイルの書き出しに失敗しました';
      
      this.showError(errorMessage);
    }
  }

  /**
   * Create batch processing notifications
   */
  showBatchResult(totalFiles: number, errors?: string[]): void {
    if (!errors || errors.length === 0) {
      this.showSuccess(`バッチ処理完了：${totalFiles}個のファイルを書き出しました`);
    } else if (errors.length < totalFiles) {
      this.showWarning(`一部のファイルでエラーが発生しました（${totalFiles - errors.length}/${totalFiles}件成功）`);
    } else {
      this.showError('バッチ処理に失敗しました');
    }
  }

  /**
   * Show processing status notifications
   */
  showProcessingStatus(message: string): void {
    this.showInfo(message, { duration: 1000 });
  }

  /**
   * Show directory setup notifications
   */
  showDirectorySetup(directoryName: string, wasExisting: boolean): void {
    const message = wasExisting
      ? `既存の出力フォルダを使用：${directoryName}`
      : `新しい出力フォルダを作成：${directoryName}`;
    
    this.showInfo(message);
  }
}

/**
 * Mock notification service for testing
 */
export class MockNotificationService implements INotificationService {
  public notifications: Array<{
    message: string;
    type: string;
    timestamp: number;
  }> = [];

  show(message: string, options: NotificationOptions = {}): void {
    const { type = 'info' } = options;
    this.notifications.push({
      message,
      type,
      timestamp: Date.now()
    });
  }

  showSuccess(message: string, options?: Omit<NotificationOptions, 'type'>): void {
    this.show(message, { ...options, type: 'success' });
  }

  showError(message: string, options?: Omit<NotificationOptions, 'type'>): void {
    this.show(message, { ...options, type: 'error' });
  }

  showInfo(message: string, options?: Omit<NotificationOptions, 'type'>): void {
    this.show(message, { ...options, type: 'info' });
  }

  showWarning(message: string, options?: Omit<NotificationOptions, 'type'>): void {
    this.show(message, { ...options, type: 'warning' });
  }

  // Test utility methods
  getNotificationCount(): number {
    return this.notifications.length;
  }

  getLastNotification() {
    return this.notifications[this.notifications.length - 1];
  }

  getNotificationsByType(type: string) {
    return this.notifications.filter(n => n.type === type);
  }

  clearNotifications(): void {
    this.notifications = [];
  }
}