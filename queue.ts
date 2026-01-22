interface QueuedRequest {
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  cancelled: boolean;
  timestamp: number;
}

export class RequestQueue {
  private workers: number;
  private interval: number;
  private queue: (QueuedRequest | undefined)[];
  private queueOffset: number;
  private running: boolean;
  private activeWorkers: number;
  private stop: boolean;

  constructor(workers: number = 1, interval: number = 1000) {
    this.workers = Math.max(1, workers);
    this.interval = Math.max(0, interval);
    this.queue = [];
    this.queueOffset = 0;
    this.running = false;
    this.activeWorkers = 0;
    this.stop = false;
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    this.stop = false;

    for (let i = 0; i < this.workers; i++) {
      this.worker();
    }
  }

  stopQueue(): void {
    this.running = false;
    this.stop = true;
  }

  private async worker(): Promise<void> {
    this.activeWorkers++;

    while (!this.stop && this.running) {
      if (this.getQueueLength() === 0) {
        await this.sleep(50);
        continue;
      }

      const request = this.dequeue();
      if (!request) continue;

      try {
        if (request.cancelled) {
          request.reject(new Error('Request was cancelled'));
          continue;
        }

        const result = await request.execute();
        request.resolve(result);
      } catch (err) {
        request.reject(err);
      }

      if (this.interval > 0) {
        await this.sleep(this.interval);
      }
    }

    this.activeWorkers--;
  }

  enqueue(execute: () => Promise<any>): Promise<any> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        execute,
        resolve,
        reject,
        cancelled: false,
        timestamp: Date.now(),
      };

      this.queue.push(request);

      if (!this.running) {
        this.start();
      }
    });
  }

  getStatus(): {
    queueLength: number;
    activeWorkers: number;
    running: boolean;
  } {
    return {
      queueLength: this.getQueueLength(),
      activeWorkers: this.activeWorkers,
      running: this.running,
    };
  }

  clear(): void {
    const pendingRequests = this.queue.slice(this.queueOffset);
    this.queue = [];
    this.queueOffset = 0;
    pendingRequests.forEach((request) => {
      if (request) {
        request.cancelled = true;
        request.reject(new Error('Queue was cleared'));
      }
    });
  }

  private dequeue(): QueuedRequest | null {
    if (this.getQueueLength() === 0) {
      return null;
    }

    const request = this.queue[this.queueOffset];
    this.queue[this.queueOffset] = undefined;
    this.queueOffset++;

    if (this.queueOffset >= this.queue.length) {
      this.queue = [];
      this.queueOffset = 0;
      return request || null;
    }

    if (this.queueOffset > 1024 && this.queueOffset * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.queueOffset);
      this.queueOffset = 0;
    }

    return request || null;
  }

  getQueueLength(): number {
    return this.queue.length - this.queueOffset;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
