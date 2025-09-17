import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerService, MockWorkerService, type WorkerMessage, type WorkerResponse } from '../services/WorkerService';

interface TestWorker {
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

// Mock debugController
vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn()
  }
}));

describe('WorkerService', () => {
  let mockWorker: TestWorker;
  let workerService: WorkerService;

  beforeEach(() => {
    mockWorker = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    
    workerService = new WorkerService(mockWorker as unknown as Worker);
  });

  describe('constructor', () => {
    it('should setup message listener when worker is provided', () => {
      expect(mockWorker.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should handle null worker gracefully', () => {
      const service = new WorkerService(null);
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('setWorker', () => {
    it('should update worker and setup new listener', () => {
      const newWorker: TestWorker = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };

      workerService.setWorker(newWorker as unknown as Worker);

      expect(mockWorker.removeEventListener).toHaveBeenCalled();
      expect(newWorker.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      expect(workerService.isAvailable()).toBe(true);
    });

    it('should handle setting worker to null', () => {
      workerService.setWorker(null);

      expect(mockWorker.removeEventListener).toHaveBeenCalled();
      expect(workerService.isAvailable()).toBe(false);
    });
  });

  describe('postMessage', () => {
    it('should send message to worker when available', () => {
      const message: WorkerMessage = {
        type: 'compose',
        payload: { test: 'data' }
      };

      workerService.postMessage(message);

      expect(mockWorker.postMessage).toHaveBeenCalledWith(message);
    });

    it('should warn when no worker is available', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      workerService.setWorker(null);
      
      const message: WorkerMessage = { type: 'test' };
      workerService.postMessage(message);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[WorkerService] No worker available to send message:', 
        message
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('message handling', () => {
    it('should add and call message handlers', async () => {
      const handler = vi.fn();
      const response: WorkerResponse = {
        type: 'compose',
        images: {}
      };

      workerService.onMessage(handler);

      // Simulate worker message
      const messageHandler = mockWorker.addEventListener.mock.calls[0][1];
      await messageHandler({ data: response });

      expect(handler).toHaveBeenCalledWith(response);
    });

    it('should remove message handlers', async () => {
      const handler = vi.fn();
      const response: WorkerResponse = {
        type: 'compose',
        images: {}
      };

      workerService.onMessage(handler);
      workerService.removeMessageHandler(handler);

      // Simulate worker message
      const messageHandler = mockWorker.addEventListener.mock.calls[0][1];
      await messageHandler({ data: response });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple message handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const response: WorkerResponse = {
        type: 'compose',
        images: {}
      };

      workerService.onMessage(handler1);
      workerService.onMessage(handler2);

      // Simulate worker message
      const messageHandler = mockWorker.addEventListener.mock.calls[0][1];
      await messageHandler({ data: response });

      expect(handler1).toHaveBeenCalledWith(response);
      expect(handler2).toHaveBeenCalledWith(response);
    });

    it('should handle errors in message handlers gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      const normalHandler = vi.fn();
      const response: WorkerResponse = {
        type: 'compose',
        images: {}
      };

      workerService.onMessage(errorHandler);
      workerService.onMessage(normalHandler);

      // Simulate worker message
      const messageHandler = mockWorker.addEventListener.mock.calls[0][1];
      await messageHandler({ data: response });

      expect(consoleSpy).toHaveBeenCalledWith('[WorkerService] Error in message handler:', expect.any(Error));
      expect(normalHandler).toHaveBeenCalledWith(response); // Other handlers should still work
      
      consoleSpy.mockRestore();
    });

    it('should warn about messages without type', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = vi.fn();
      const invalidResponse = { data: 'test' }; // No type property

      workerService.onMessage(handler);

      // Simulate worker message
      const messageHandler = mockWorker.addEventListener.mock.calls[0][1];
      await messageHandler({ data: invalidResponse });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[WorkerService] Received message without type:', 
        invalidResponse
      );
      expect(handler).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('should clean up worker and handlers', () => {
      const handler = vi.fn();
      workerService.onMessage(handler);

      workerService.dispose();

      expect(mockWorker.removeEventListener).toHaveBeenCalled();
      expect(workerService.isAvailable()).toBe(false);
    });
  });
});

describe('MockWorkerService', () => {
  let mockWorkerService: MockWorkerService;

  beforeEach(() => {
    mockWorkerService = new MockWorkerService();
  });

  describe('postMessage', () => {
    it('should record sent messages', () => {
      const message1: WorkerMessage = { type: 'compose', payload: { test: 1 } };
      const message2: WorkerMessage = { type: 'detect', payload: { test: 2 } };

      mockWorkerService.postMessage(message1);
      mockWorkerService.postMessage(message2);

      expect(mockWorkerService.getMessageCount()).toBe(2);
      expect(mockWorkerService.getLastMessage()).toEqual(message2);
      expect(mockWorkerService.sentMessages).toEqual([message1, message2]);
    });
  });

  describe('message simulation', () => {
    it('should simulate messages to handlers', async () => {
      const handler = vi.fn();
      const response: WorkerResponse = {
        type: 'compose',
        images: { 'test.jpg': {} as ImageBitmap }
      };

      mockWorkerService.onMessage(handler);
      await mockWorkerService.simulateMessage(response);

      expect(handler).toHaveBeenCalledWith(response);
    });

    it('should handle multiple handlers in simulation', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const response: WorkerResponse = {
        type: 'composeMany',
        outputs: []
      };

      mockWorkerService.onMessage(handler1);
      mockWorkerService.onMessage(handler2);
      await mockWorkerService.simulateMessage(response);

      expect(handler1).toHaveBeenCalledWith(response);
      expect(handler2).toHaveBeenCalledWith(response);
    });
  });

  describe('utility methods', () => {
    it('should provide message count and access', () => {
      expect(mockWorkerService.getMessageCount()).toBe(0);
      expect(mockWorkerService.getLastMessage()).toBeUndefined();

      mockWorkerService.postMessage({ type: 'test' });

      expect(mockWorkerService.getMessageCount()).toBe(1);
      expect(mockWorkerService.getLastMessage()).toEqual({ type: 'test' });
    });

    it('should clear messages', () => {
      mockWorkerService.postMessage({ type: 'test1' });
      mockWorkerService.postMessage({ type: 'test2' });
      
      expect(mockWorkerService.getMessageCount()).toBe(2);
      
      mockWorkerService.clearMessages();
      
      expect(mockWorkerService.getMessageCount()).toBe(0);
      expect(mockWorkerService.getLastMessage()).toBeUndefined();
    });

    it('should always report as available', () => {
      expect(mockWorkerService.isAvailable()).toBe(true);
    });
  });
});
