/**
 * Request Queue for ERLC API
 * Manages queued API requests to prevent rate limit issues
 */

class RequestQueue {
  /**
   * @param {number} workers - Number of workers to process requests
   * @param {number} interval - Interval between requests in milliseconds
   */
  constructor(workers = 1, interval = 1000) {
    this.workers = Math.max(1, workers);
    this.interval = Math.max(0, interval);
    this.queue = [];
    this.queueOffset = 0;
    this.running = false;
    this.activeWorkers = 0;
    this.stop = false;
  }

  /**
   * Start processing queued requests
   */
  start() {
    if (this.running) return;

    this.running = true;
    this.stop = false;

    for (let i = 0; i < this.workers; i++) {
      this.worker();
    }
  }

  /**
   * Stop processing requests
   */
  stopQueue() {
    this.running = false;
    this.stop = true;
  }

  /**
   * Worker function to process requests
   */
  async worker() {
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
      } catch (e) {
        request.reject(e);
      }

      if (this.interval > 0) {
        await this.sleep(this.interval);
      }
    }

    this.activeWorkers--;
  }

  /**
   * Add a request to the queue
   * @param {Function} execute - Function that executes the request
   * @returns {Promise} Promise that resolves with the request result
   */
  enqueue(execute) {
    return new Promise((resolve, reject) => {
      const request = {
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

  /**
   * Get current queue status
   * @returns {{queueLength: number, activeWorkers: number, running: boolean}}
   */
  getStatus() {
    return {
      queueLength: this.getQueueLength(),
      activeWorkers: this.activeWorkers,
      running: this.running,
    };
  }

  /**
   * Clear all pending requests
   */
  clear() {
    const pendingRequests = this.queue.slice(this.queueOffset);
    this.queue = [];
    this.queueOffset = 0;
    pendingRequests.forEach((request) => {
      request.cancelled = true;
      request.reject(new Error('Queue was cleared'));
    });
  }

  /**
   * Remove next request without incurring O(n) array shifts
   * @returns {Object|null}
   */
  dequeue() {
    if (this.getQueueLength() === 0) {
      return null;
    }

    const request = this.queue[this.queueOffset];
    this.queue[this.queueOffset] = undefined;
    this.queueOffset++;

    if (this.queueOffset >= this.queue.length) {
      this.queue = [];
      this.queueOffset = 0;
      return request;
    }

    if (this.queueOffset > 1024 && this.queueOffset * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.queueOffset);
      this.queueOffset = 0;
    }

    return request;
  }

  /**
   * Current number of queued requests
   * @returns {number}
   */
  getQueueLength() {
    return this.queue.length - this.queueOffset;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { RequestQueue };
