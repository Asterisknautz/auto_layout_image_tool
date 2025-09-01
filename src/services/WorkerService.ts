import { debugController } from '../utils/debugMode';

export interface WorkerMessage {
  type: string;
  payload?: unknown;
  profileKey?: string;
  [key: string]: unknown;
}

export interface WorkerResponse {
  type: string;
  images?: Record<string, ImageBitmap>;
  outputs?: Array<{ 
    filename: string; 
    image: ImageBitmap; 
    psd?: Blob; 
    png?: Blob; 
    formats?: string[] 
  }>;
  psd?: Blob;
  [key: string]: unknown;
}

export type WorkerMessageHandler = (data: WorkerResponse) => void | Promise<void>;

export interface IWorkerService {
  postMessage(message: WorkerMessage): void;
  onMessage(handler: WorkerMessageHandler): void;
  removeMessageHandler(handler: WorkerMessageHandler): void;
  isAvailable(): boolean;
}

export class WorkerService implements IWorkerService {
  private messageHandlers = new Set<WorkerMessageHandler>();
  private isListening = false;

  constructor(private worker: Worker | null = null) {
    if (this.worker) {
      this.setupMessageListener();
    }
  }

  /**
   * Set or update the worker instance
   */
  setWorker(worker: Worker | null): void {
    if (this.worker && this.isListening) {
      this.worker.removeEventListener('message', this.handleWorkerMessage);
      this.isListening = false;
    }
    
    this.worker = worker;
    
    if (this.worker) {
      this.setupMessageListener();
    }
  }

  /**
   * Check if worker is available
   */
  isAvailable(): boolean {
    return this.worker !== null;
  }

  /**
   * Send message to worker
   */
  postMessage(message: WorkerMessage): void {
    if (!this.worker) {
      console.warn('[WorkerService] No worker available to send message:', message);
      return;
    }

    debugController.log('WorkerService', 'Sending message to worker:', message.type);
    this.worker.postMessage(message);
  }

  /**
   * Add message handler
   */
  onMessage(handler: WorkerMessageHandler): void {
    this.messageHandlers.add(handler);
    debugController.log('WorkerService', 'Added message handler, total handlers:', this.messageHandlers.size);
  }

  /**
   * Remove message handler
   */
  removeMessageHandler(handler: WorkerMessageHandler): void {
    this.messageHandlers.delete(handler);
    debugController.log('WorkerService', 'Removed message handler, total handlers:', this.messageHandlers.size);
  }

  /**
   * Setup worker message listener
   */
  private setupMessageListener(): void {
    if (!this.worker || this.isListening) return;

    this.worker.addEventListener('message', this.handleWorkerMessage);
    this.isListening = true;
    debugController.log('WorkerService', 'Setup message listener for worker');
  }

  /**
   * Handle worker messages and distribute to handlers
   */
  private handleWorkerMessage = async (event: MessageEvent) => {
    const data: WorkerResponse = event.data;
    debugController.log('WorkerService', 'Received worker message:', data?.type);

    if (!data?.type) {
      console.warn('[WorkerService] Received message without type:', data);
      return;
    }

    // Distribute message to all handlers
    const handlerPromises = Array.from(this.messageHandlers).map(async (handler) => {
      try {
        await handler(data);
      } catch (error) {
        console.error('[WorkerService] Error in message handler:', error);
      }
    });

    // Wait for all handlers to complete
    await Promise.all(handlerPromises);
  };

  /**
   * Clean up worker service
   */
  dispose(): void {
    if (this.worker && this.isListening) {
      this.worker.removeEventListener('message', this.handleWorkerMessage);
    }
    
    this.messageHandlers.clear();
    this.isListening = false;
    this.worker = null;
    debugController.log('WorkerService', 'Worker service disposed');
  }
}

/**
 * Utility function to create a mock worker service for testing
 */
export class MockWorkerService implements IWorkerService {
  public sentMessages: WorkerMessage[] = [];
  private messageHandlers = new Set<WorkerMessageHandler>();

  postMessage(message: WorkerMessage): void {
    this.sentMessages.push(message);
  }

  onMessage(handler: WorkerMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  removeMessageHandler(handler: WorkerMessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  isAvailable(): boolean {
    return true;
  }

  // Test utility methods
  async simulateMessage(response: WorkerResponse): Promise<void> {
    const handlerPromises = Array.from(this.messageHandlers).map(handler => handler(response));
    await Promise.all(handlerPromises);
  }

  clearMessages(): void {
    this.sentMessages = [];
  }

  getMessageCount(): number {
    return this.sentMessages.length;
  }

  getLastMessage(): WorkerMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }
}