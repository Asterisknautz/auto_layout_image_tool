import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService, MockNotificationService, type NotificationCallback } from '../services/NotificationService';

// Mock debugController
vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn()
  }
}));

describe('NotificationService', () => {
  let notificationService: NotificationService;
  let mockCallback: NotificationCallback;

  beforeEach(() => {
    mockCallback = vi.fn();
    notificationService = new NotificationService(mockCallback);
  });

  describe('constructor', () => {
    it('should accept callback in constructor', () => {
      const service = new NotificationService(mockCallback);
      service.show('test');
      expect(mockCallback).toHaveBeenCalledWith('test', 'info');
    });

    it('should work without callback', () => {
      const service = new NotificationService();
      expect(() => service.show('test')).not.toThrow();
    });
  });

  describe('setCallback', () => {
    it('should update callback function', () => {
      const newCallback = vi.fn();
      notificationService.setCallback(newCallback);
      
      notificationService.show('test');
      
      expect(newCallback).toHaveBeenCalledWith('test', 'info');
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('show', () => {
    it('should call callback with default options', () => {
      notificationService.show('test message');
      
      expect(mockCallback).toHaveBeenCalledWith('test message', 'info');
    });

    it('should call callback with custom options', () => {
      notificationService.show('error message', { type: 'error', duration: 5000 });
      
      expect(mockCallback).toHaveBeenCalledWith('error message', 'error');
    });

    it('should fallback to console when no callback is set', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const service = new NotificationService();
      service.show('test', { type: 'success' });
      
      expect(consoleWarnSpy).toHaveBeenCalledWith('[NotificationService] No callback set, falling back to console');
      expect(consoleSpy).toHaveBeenCalledWith('[SUCCESS] test');
      
      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('convenience methods', () => {
    it('should show success notification', () => {
      notificationService.showSuccess('Success!');
      expect(mockCallback).toHaveBeenCalledWith('Success!', 'success');
    });

    it('should show error notification with persistent default', () => {
      notificationService.showError('Error!');
      expect(mockCallback).toHaveBeenCalledWith('Error!', 'error');
    });

    it('should show info notification', () => {
      notificationService.showInfo('Info!');
      expect(mockCallback).toHaveBeenCalledWith('Info!', 'info');
    });

    it('should show warning notification', () => {
      notificationService.showWarning('Warning!');
      expect(mockCallback).toHaveBeenCalledWith('Warning!', 'warning');
    });

    it('should pass through additional options', () => {
      notificationService.showSuccess('Success!', { duration: 5000 });
      expect(mockCallback).toHaveBeenCalledWith('Success!', 'success');
    });
  });

  describe('showExportResult', () => {
    it('should show success notification for successful export with profile', () => {
      notificationService.showExportResult(true, 3, 'mobile');
      
      expect(mockCallback).toHaveBeenCalledWith('mobileプロファイル：3個のファイルを書き出しました', 'success');
    });

    it('should show success notification for successful export without profile', () => {
      notificationService.showExportResult(true, 5);
      
      expect(mockCallback).toHaveBeenCalledWith('5個のファイルを書き出しました', 'success');
    });

    it('should show error notification for failed export with errors', () => {
      notificationService.showExportResult(false, 0, 'pc', ['Permission denied', 'File not found']);
      
      expect(mockCallback).toHaveBeenCalledWith('書き出しに失敗しました: Permission denied', 'error');
    });

    it('should show generic error notification for failed export without specific errors', () => {
      notificationService.showExportResult(false, 0, 'sns');
      
      expect(mockCallback).toHaveBeenCalledWith('ファイルの書き出しに失敗しました', 'error');
    });
  });

  describe('showBatchResult', () => {
    it('should show success notification for successful batch processing', () => {
      notificationService.showBatchResult(10);
      
      expect(mockCallback).toHaveBeenCalledWith('バッチ処理完了：10個のファイルを書き出しました', 'success');
    });

    it('should show success notification when no errors array is provided', () => {
      notificationService.showBatchResult(5, []);
      
      expect(mockCallback).toHaveBeenCalledWith('バッチ処理完了：5個のファイルを書き出しました', 'success');
    });

    it('should show warning notification for partial success', () => {
      notificationService.showBatchResult(10, ['Error 1', 'Error 2']);
      
      expect(mockCallback).toHaveBeenCalledWith('一部のファイルでエラーが発生しました（8/10件成功）', 'warning');
    });

    it('should show error notification for complete failure', () => {
      const errors = ['Error 1', 'Error 2', 'Error 3'];
      notificationService.showBatchResult(3, errors);
      
      expect(mockCallback).toHaveBeenCalledWith('バッチ処理に失敗しました', 'error');
    });
  });

  describe('showProcessingStatus', () => {
    it('should show info notification with short duration', () => {
      notificationService.showProcessingStatus('処理中...');
      
      expect(mockCallback).toHaveBeenCalledWith('処理中...', 'info');
    });
  });

  describe('showDirectorySetup', () => {
    it('should show notification for existing directory', () => {
      notificationService.showDirectorySetup('/path/to/folder', true);
      
      expect(mockCallback).toHaveBeenCalledWith('既存の出力フォルダを使用：/path/to/folder', 'info');
    });

    it('should show notification for new directory', () => {
      notificationService.showDirectorySetup('/path/to/new/folder', false);
      
      expect(mockCallback).toHaveBeenCalledWith('新しい出力フォルダを作成：/path/to/new/folder', 'info');
    });
  });
});

describe('MockNotificationService', () => {
  let mockService: MockNotificationService;

  beforeEach(() => {
    mockService = new MockNotificationService();
  });

  describe('notification recording', () => {
    it('should record notifications with timestamps', () => {
      const startTime = Date.now();
      mockService.show('test message', { type: 'success' });
      const endTime = Date.now();
      
      expect(mockService.getNotificationCount()).toBe(1);
      
      const notification = mockService.getLastNotification();
      expect(notification.message).toBe('test message');
      expect(notification.type).toBe('success');
      expect(notification.timestamp).toBeGreaterThanOrEqual(startTime);
      expect(notification.timestamp).toBeLessThanOrEqual(endTime);
    });

    it('should record multiple notifications', () => {
      mockService.showSuccess('Success!');
      mockService.showError('Error!');
      mockService.showInfo('Info!');
      
      expect(mockService.getNotificationCount()).toBe(3);
      
      const successNotifications = mockService.getNotificationsByType('success');
      const errorNotifications = mockService.getNotificationsByType('error');
      const infoNotifications = mockService.getNotificationsByType('info');
      
      expect(successNotifications).toHaveLength(1);
      expect(errorNotifications).toHaveLength(1);
      expect(infoNotifications).toHaveLength(1);
      
      expect(successNotifications[0].message).toBe('Success!');
      expect(errorNotifications[0].message).toBe('Error!');
      expect(infoNotifications[0].message).toBe('Info!');
    });
  });

  describe('convenience methods', () => {
    it('should record success notifications', () => {
      mockService.showSuccess('Success message');
      
      const notifications = mockService.getNotificationsByType('success');
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toBe('Success message');
    });

    it('should record error notifications', () => {
      mockService.showError('Error message');
      
      const notifications = mockService.getNotificationsByType('error');
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toBe('Error message');
    });

    it('should record info notifications', () => {
      mockService.showInfo('Info message');
      
      const notifications = mockService.getNotificationsByType('info');
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toBe('Info message');
    });

    it('should record warning notifications', () => {
      mockService.showWarning('Warning message');
      
      const notifications = mockService.getNotificationsByType('warning');
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toBe('Warning message');
    });
  });

  describe('utility methods', () => {
    it('should provide notification count', () => {
      expect(mockService.getNotificationCount()).toBe(0);
      
      mockService.show('test1');
      expect(mockService.getNotificationCount()).toBe(1);
      
      mockService.show('test2');
      expect(mockService.getNotificationCount()).toBe(2);
    });

    it('should provide last notification', () => {
      expect(mockService.getLastNotification()).toBeUndefined();
      
      mockService.show('first');
      expect(mockService.getLastNotification().message).toBe('first');
      
      mockService.show('second');
      expect(mockService.getLastNotification().message).toBe('second');
    });

    it('should filter notifications by type', () => {
      mockService.showSuccess('Success 1');
      mockService.showError('Error 1');
      mockService.showSuccess('Success 2');
      mockService.showInfo('Info 1');
      
      expect(mockService.getNotificationsByType('success')).toHaveLength(2);
      expect(mockService.getNotificationsByType('error')).toHaveLength(1);
      expect(mockService.getNotificationsByType('info')).toHaveLength(1);
      expect(mockService.getNotificationsByType('warning')).toHaveLength(0);
    });

    it('should clear notifications', () => {
      mockService.show('test1');
      mockService.show('test2');
      expect(mockService.getNotificationCount()).toBe(2);
      
      mockService.clearNotifications();
      expect(mockService.getNotificationCount()).toBe(0);
      expect(mockService.getLastNotification()).toBeUndefined();
    });
  });
});