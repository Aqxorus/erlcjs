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
      if (this.queue.length === 0) {
        await this.sleep(50); // Short sleep when queue is empty
        continue;
      }

      const request = this.queue.shift();
      if (!request) continue;

      try {
        // Check if request was cancelled
        if (request.cancelled) {
          request.reject(new Error('Request was cancelled'));
          continue;
        }

        const result = await request.execute();
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }

      // Wait before processing next request
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

      // Auto-start if not running
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
      queueLength: this.queue.length,
      activeWorkers: this.activeWorkers,
      running: this.running,
    };
  }

  /**
   * Clear all pending requests
   */
  clear() {
    const pendingRequests = this.queue.splice(0);
    pendingRequests.forEach((request) => {
      request.cancelled = true;
      request.reject(new Error('Queue was cleared'));
    });
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
