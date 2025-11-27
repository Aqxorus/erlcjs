/**
 * ERLC API Client
 * Main client class for interacting with the Emergency Response: Liberty County API
 */

const { RateLimiter } = require('./rateLimiter');
const { RequestQueue } = require('./queue');
const { MemoryCache } = require('./cache');
const { Subscription, getDefaultEventConfig } = require('./subscription');
const { getFriendlyErrorMessage } = require('./types');
const Sentry = require('@sentry/node');

class ERLCClient {
  /**
   * Create a new ERLC API client
   * @param {string} apiKey - The API key for authentication
   * @param {ClientOptions} [options] - Client configuration options
   */
  constructor(apiKey, options = {}) {
    if (!apiKey) {
      throw new Error('API key is required');
    }

    this.apiKey = apiKey;
    this.baseURL = options.baseURL || 'https://api.policeroleplay.community/v1';
    this.timeout = options.timeout || 10000;
    this.keepAlive = options.keepAlive !== false;

    this.rateLimiter = new RateLimiter();

    this.queue = null;
    if (options.requestQueue) {
      this.queue = new RequestQueue(
        options.requestQueue.workers,
        options.requestQueue.interval
      );
      this.queue.start();
    }

    this.cache = null;
    if (options.cache && options.cache.enabled) {
      this.cache = {
        instance: new MemoryCache(options.cache.maxItems),
        ttl: options.cache.ttl || 60000,
        staleIfError: options.cache.staleIfError || false,
        prefix: options.cache.prefix || 'erlc:',
      };
    }
  }

  /**
   * Get a list of players currently on the server
   * @returns {Promise<ERLCServerPlayer[]>} Array of players
   */
  async getPlayers() {
    return this.get('/server/players');
  }

  /**
   * Get command execution history
   * @returns {Promise<ERLCCommandLog[]>} Array of command logs
   */
  async getCommandLogs() {
    return this.get('/server/commandlogs');
  }

  /**
   * Get moderation call history
   * @returns {Promise<ERLCModCallLog[]>} Array of mod call logs
   */
  async getModCalls() {
    return this.get('/server/modcalls');
  }

  /**
   * Get kill log history
   * @returns {Promise<ERLCKillLog[]>} Array of kill logs
   */
  async getKillLogs() {
    return this.get('/server/killlogs');
  }

  /**
   * Get server join/leave history
   * @returns {Promise<ERLCJoinLog[]>} Array of join logs
   */
  async getJoinLogs() {
    return this.get('/server/joinlogs');
  }

  /**
   * Get list of vehicles on the server
   * @returns {Promise<ERLCVehicle[]>} Array of vehicles
   */
  async getVehicles() {
    return this.get('/server/vehicles');
  }

  /**
   * Get server information and player count
   * @returns {Promise<Object>} Server information
   */
  async getServer() {
    return this.get('/server');
  }

  /**
   * Get server queue information
   * @returns {Promise<Object>} Queue information
   */
  async getQueue() {
    return this.get('/server/queue');
  }

  /**
   * Get server ban information
   * @returns {Promise<Object>} Ban information
   */
  async getBans() {
    return this.get('/server/bans');
  }

  /**
   * Execute a server command
   * @param {string} command - The command to execute (with leading slash)
   * @returns {Promise<void>}
   */
  async executeCommand(command) {
    const data = { command };
    return this.post('/server/command', data);
  }

  /**
   * Subscribe to real-time events
   * @param {string[]} eventTypes - Array of event types to subscribe to
   * @param {EventConfig} [config] - Event configuration
   * @returns {Subscription} Event subscription
   */
  subscribe(eventTypes, config = {}) {
    const subscription = new Subscription(this, config, eventTypes);
    return subscription;
  }

  /**
   * Subscribe to real-time events with custom configuration
   * @param {EventConfig} config - Event configuration
   * @param {string[]} eventTypes - Array of event types to subscribe to
   * @returns {Subscription} Event subscription
   */
  subscribeWithConfig(config, ...eventTypes) {
    return this.subscribe(eventTypes, config);
  }

  /**
   * Make a GET request to the API
   * @param {string} path - API endpoint path
   * @returns {Promise<*>} Response data
   */
  async get(path) {
    const cacheKey = this.cache ? `${this.cache.prefix}${path}` : null;

    if (this.cache && cacheKey) {
      const cached = this.cache.instance.get(cacheKey);
      if (cached.found) {
        return cached.value;
      }
    }

    const execute = async () => {
      const response = await this.makeRequest('GET', path);

      if (this.cache && cacheKey && response.ok) {
        const data = await response.json();
        this.cache.instance.set(cacheKey, data, this.cache.ttl);
        return data;
      }

      return this.handleResponse(response);
    };

    if (this.queue) {
      return this.queue.enqueue(execute);
    }

    return execute();
  }

  /**
   * Make a POST request to the API
   * @param {string} path - API endpoint path
   * @param {Object} data - Request body data
   * @returns {Promise<*>} Response data
   */
  async post(path, data) {
    const execute = async () => {
      const response = await this.makeRequest('POST', path, data);
      return this.handleResponse(response);
    };

    if (this.queue) {
      return this.queue.enqueue(execute);
    }

    return execute();
  }

  /**
   * Make an HTTP request to the API
   * @param {string} method - HTTP method
   * @param {string} path - API endpoint path
   * @param {Object} [data] - Request body data
   * @returns {Promise<Response>} Fetch response
   */
  async makeRequest(method, path, data = null) {
    return this.makeRequestWithRetry(method, path, data, 3);
  }

  /**
   * Make an HTTP request with retry logic for transient network errors
   * @param {string} method - HTTP method
   * @param {string} path - API endpoint path
   * @param {Object} [data] - Request body data
   * @param {number} maxRetries - Maximum number of retry attempts
   * @param {number} baseDelay - Base delay in milliseconds for exponential backoff
   * @returns {Promise<Response>} Fetch response
   */
  async makeRequestWithRetry(
    method,
    path,
    data = null,
    maxRetries = 3,
    baseDelay = 1000
  ) {
    const url = `${this.baseURL}${path}`;
    let lastError;
    const perAttemptTimeout = Math.max(2000, Number(this.timeout) || 0);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (this.rateLimiter) {
          const { duration, shouldWait } =
            this.rateLimiter.shouldWait('global');
          if (shouldWait) {
            await this.sleep(duration);
          }
        }

        const options = {
          method,
          headers: {
            'Server-Key': this.apiKey,
            'Content-Type': 'application/json',
            // If keep-alive is disabled or we're retrying after a transient socket error, force a fresh connection
            ...(!this.keepAlive || attempt > 0 ? { Connection: 'close' } : {}),
          },
          signal: AbortSignal.timeout(perAttemptTimeout),
        };

        if (data && method !== 'GET') {
          options.body = JSON.stringify(data);
        }

        const response = await Sentry.startSpan(
          {
            op: 'http.client',
            name: `${method} ${path}`,
          },
          async (span) => {
            span.setAttribute('http.method', method);
            span.setAttribute('http.target', path);
            span.setAttribute('http.url', url);
            span.setAttribute('retry.attempt', attempt);
            span.setAttribute('timeout.ms', perAttemptTimeout);

            try {
              const res = await fetch(url, options);
              span.setAttribute('http.status_code', res.status);
              span.setAttribute('http.ok', res.ok);
              return res;
            } catch (err) {
              span.setAttribute('error', true);
              span.setAttribute('error.name', err?.name || 'Error');
              span.setAttribute('error.message', err?.message || '');
              throw err;
            }
          }
        );

        // If we are rate limited, respect server-provided cooldown and retry
        if (response.status === 429) {
          // Try to compute a meaningful retry delay
          const retryAfterHeader = response.headers.get('Retry-After');
          const resetHeader = response.headers.get('X-RateLimit-Reset');

          let retryAfterMs = 0;
          if (retryAfterHeader) {
            const asNumber = Number(retryAfterHeader);
            if (!Number.isNaN(asNumber)) {
              retryAfterMs = Math.max(0, asNumber * 1000);
            } else {
              const date = new Date(retryAfterHeader);
              const diff = date.getTime() - Date.now();
              if (!Number.isNaN(date.getTime())) {
                retryAfterMs = Math.max(0, diff);
              }
            }
          }

          if (!retryAfterMs && resetHeader) {
            const resetEpoch = Number(resetHeader);
            if (!Number.isNaN(resetEpoch)) {
              const diff = resetEpoch * 1000 - Date.now();
              retryAfterMs = Math.max(0, diff);
            }
          }

          if (!retryAfterMs) {
            // Fallback to a sane default if headers are missing
            retryAfterMs = 5000;
          }

          if (this.rateLimiter) {
            this.rateLimiter.updateFromHeaders(
              'global',
              0,
              0,
              new Date(Date.now() + retryAfterMs)
            );
          }

          if (attempt < maxRetries) {
            console.warn(
              `[ERLC Client] HTTP 429 received. Respecting Retry-After and retrying in ${Math.round(
                retryAfterMs
              )}ms (attempt ${attempt + 1}/${maxRetries + 1}).`
            );
            await this.sleep(retryAfterMs);
            continue; // try again
          }

          // Exhausted retries, return response to be handled by handleResponse
          return response;
        }

        if (this.rateLimiter && response.headers) {
          const limit =
            parseInt(response.headers.get('X-RateLimit-Limit')) || 0;
          const remaining =
            parseInt(response.headers.get('X-RateLimit-Remaining')) || 0;
          const reset =
            parseInt(response.headers.get('X-RateLimit-Reset')) || 0;

          if (limit > 0) {
            this.rateLimiter.updateFromHeaders(
              'global',
              limit,
              remaining,
              new Date(reset * 1000)
            );
          }
        }

        return response;
      } catch (e) {
        lastError = e;

        if (attempt < maxRetries && this.isRetryableError(e)) {
          const delay = this.calculateBackoffDelay(attempt, baseDelay);

          console.warn(
            `[ERLC Client] Request failed (attempt ${attempt + 1}/${
              maxRetries + 1
            }): ${e.message}. Retrying in ${Math.round(delay)}ms...`
          );
          await this.sleep(delay);
          continue;
        }

        try {
          Sentry.captureException(e, {
            tags: { module: 'ERLCClient', op: 'http.client' },
            extra: {
              method,
              path,
              url,
              attempt,
              maxRetries,
              message: e?.message,
              name: e?.name,
              code: e?.code,
            },
          });
        } catch {}

        throw e;
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} Whether the error is retryable
   */
  isRetryableError(error) {
    if (
      error.code === 'ECONNRESET' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'EAI_AGAIN'
    ) {
      return true;
    }

    if (error.name === 'TypeError' && error.message === 'fetch failed') {
      return true;
    }

    // Undici/Node fetch transient socket errors
    if (
      error.name === 'SocketError' ||
      (typeof error.message === 'string' &&
        (error.message.includes('other side closed') ||
          error.message.includes('socket hang up') ||
          error.message.includes('reset by peer')))
    ) {
      return true;
    }

    if (error.name === 'TimeoutError') {
      return true;
    }

    if (error.cause && this.isRetryableError(error.cause)) {
      return true;
    }

    if (error.status >= 500 && error.status < 600) {
      return true;
    }

    return false;
  }

  /**
   * Calculate exponential backoff delay with jitter
   * @param {number} attempt - Current attempt number (0-based)
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {number} Delay in milliseconds
   */
  calculateBackoffDelay(attempt, baseDelay) {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);
    return Math.max(500, exponentialDelay + jitter);
  }

  /**
   * Handle API response and errors
   * @param {Response} response - Fetch response
   * @returns {Promise<*>} Parsed response data
   */
  async handleResponse(response) {
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const resetHeader = response.headers.get('X-RateLimit-Reset');

      let retryAfterMs = 0;
      if (retryAfterHeader) {
        const asNumber = Number(retryAfterHeader);
        if (!Number.isNaN(asNumber)) {
          retryAfterMs = Math.max(0, asNumber * 1000);
        } else {
          const date = new Date(retryAfterHeader);
          const diff = date.getTime() - Date.now();
          if (!Number.isNaN(date.getTime())) {
            retryAfterMs = Math.max(0, diff);
          }
        }
      }

      if (!retryAfterMs && resetHeader) {
        const resetEpoch = Number(resetHeader);
        if (!Number.isNaN(resetEpoch)) {
          const diff = resetEpoch * 1000 - Date.now();
          retryAfterMs = Math.max(0, diff);
        }
      }

      if (!retryAfterMs) {
        retryAfterMs = 5000;
      }

      if (this.rateLimiter) {
        this.rateLimiter.updateFromHeaders(
          'global',
          0,
          0,
          new Date(Date.now() + retryAfterMs)
        );
      }

      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { code: 4001, message: 'Rate limited' };
      }

      const error = new Error(errorData.message || 'Rate limited');
      error.code = errorData.code || 4001;
      error.status = 429;
      error.retryAfter = retryAfterMs;
      throw error;
    }

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          code: 0,
          message: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const error = new Error(errorData.message || 'Unknown error');
      error.code = errorData.code || 0;
      throw error;
    }

    try {
      return await response.json();
    } catch (e) {
      throw new Error('Failed to parse response JSON');
    }
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Destroy the client and cleanup resources
   */
  destroy() {
    if (this.queue) {
      this.queue.stopQueue();
      this.queue.clear();
    }

    if (this.cache) {
      this.cache.instance.destroy();
    }

    if (this.rateLimiter) {
      this.rateLimiter.clearAll();
    }
  }

  /**
   * Get client status and statistics
   * @returns {Object} Client status information
   */
  getStatus() {
    const status = {
      rateLimiter: this.rateLimiter
        ? {
            globalStatus: this.rateLimiter.getStatus('global'),
          }
        : null,
      queue: this.queue ? this.queue.getStatus() : null,
      cache: this.cache ? this.cache.instance.getStats() : null,
    };

    return status;
  }
}

/**
 * Create a new ERLC client with options
 * @param {string} apiKey - The API key
 * @param {ClientOptions} [options] - Client options
 * @returns {ERLCClient} New client instance
 */
function createClient(apiKey, options = {}) {
  return new ERLCClient(apiKey, options);
}

module.exports = {
  ERLCClient,
  createClient,
  getFriendlyErrorMessage,
};
