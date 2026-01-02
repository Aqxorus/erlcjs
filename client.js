const { RateLimiter } = require('./rateLimiter');
const { RequestQueue } = require('./queue');
const { MemoryCache, RedisCache } = require('./cache');
const { Subscription } = require('./subscription');
const { getFriendlyErrorMessage } = require('./types');
const { PRCAPIError } = require('./errors');
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
    this.globalKey = options.globalKey;

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
      const redisUrl = options.cache.redisUrl;
      const redisKeyPrefix = options.cache.redisKeyPrefix;

      const store = redisUrl
        ? new RedisCache({
            url: redisUrl,
            keyPrefix: redisKeyPrefix || '',
          })
        : new MemoryCache(options.cache.maxItems);

      this.cache = {
        store,
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
  async getPlayers(options) {
    return this.get('/server/players', options);
  }

  /**
   * Get current server status (erlc.ts parity)
   * @returns {Promise<Object>}
   */
  async getServerStatus(options) {
    return this.getServer(options);
  }

  /**
   * Get command execution history
   * @returns {Promise<ERLCCommandLog[]>} Array of command logs
   */
  async getCommandLogs(options) {
    return this.get('/server/commandlogs', options);
  }

  /**
   * Get moderation call history
   * @returns {Promise<ERLCModCallLog[]>} Array of mod call logs
   */
  async getModCalls(options) {
    return this.get('/server/modcalls', options);
  }

  /**
   * Get kill log history
   * @returns {Promise<ERLCKillLog[]>} Array of kill logs
   */
  async getKillLogs(options) {
    return this.get('/server/killlogs', options);
  }

  /**
   * Get server join/leave history
   * @returns {Promise<ERLCJoinLog[]>} Array of join logs
   */
  async getJoinLogs(options) {
    return this.get('/server/joinlogs', options);
  }

  /**
   * Get list of vehicles on the server
   * @returns {Promise<ERLCVehicle[]>} Array of vehicles
   */
  async getVehicles(options) {
    return this.get('/server/vehicles', options);
  }

  /**
   * Get server information and player count
   * @returns {Promise<Object>} Server information
   */
  async getServer(options) {
    return this.get('/server', options);
  }

  /**
   * Get server queue information
   * @returns {Promise<Object>} Queue information
   */
  async getQueue(options) {
    return this.get('/server/queue', options);
  }

  /**
   * Get server ban information
   * @returns {Promise<Object>} Ban information
   */
  async getBans(options) {
    return this.get('/server/bans', options);
  }

  /**
   * Get server staff information
   * @returns {Promise<Object>}
   */
  async getStaff(options) {
    return this.get('/server/staff', options);
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
  async get(path, options = {}) {
    const cacheKey = this.cache ? `${this.cache.prefix}${path}` : null;
    const shouldCache = !!this.cache && options.cache !== false;
    const ttlOverride = Number(options.cacheMaxAge);
    const ttl =
      Number.isFinite(ttlOverride) && ttlOverride >= 0
        ? ttlOverride
        : this.cache?.ttl;

    let staleValue = null;

    if (shouldCache && cacheKey) {
      const store = this.cache.store;
      const cached =
        store instanceof MemoryCache
          ? store.getWithMeta(cacheKey, { allowStale: this.cache.staleIfError })
          : await store.get(cacheKey);

      if (cached?.found && !cached?.isStale) {
        return cached.value;
      }
      if (cached?.found && cached?.isStale) {
        staleValue = cached.value;
      }
    }

    const execute = async () => {
      const response = await this.makeRequest('GET', path);

      if (shouldCache && cacheKey && response.ok) {
        const data = await response.json();
        try {
          if (this.cache.store instanceof MemoryCache) {
            this.cache.store.set(cacheKey, data, ttl);
          } else {
            await this.cache.store.set(cacheKey, data, ttl);
          }
        } catch {}
        return data;
      }

      return this.handleResponse(response, {
        method: 'GET',
        path,
        url: response?.url || `${this.baseURL}${path}`,
      });
    };

    const run = this.queue ? () => this.queue.enqueue(execute) : execute;

    try {
      return await run();
    } catch (err) {
      if (this.cache && this.cache.staleIfError && staleValue !== null) {
        return staleValue;
      }
      throw err;
    }
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
      return this.handleResponse(response, {
        method: 'POST',
        path,
        url: response?.url || `${this.baseURL}${path}`,
      });
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
            ...(!this.keepAlive || attempt > 0 ? { Connection: 'close' } : {}),
            ...(this.globalKey ? { Authorization: this.globalKey } : {}),
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

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('Retry-After');
          const resetHeader = response.headers.get('X-RateLimit-Reset');

          let bodyRetryAfterMs = 0;
          try {
            const cloned = response.clone();
            const body = await cloned.json().catch(() => null);
            if (
              body &&
              typeof body.retry_after === 'number' &&
              body.retry_after > 0
            ) {
              bodyRetryAfterMs = Math.max(
                0,
                Math.round(body.retry_after * 1000)
              );
            }
          } catch {}

          let retryAfterMs = bodyRetryAfterMs || 0;
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

          if (attempt < maxRetries) {
            console.warn(
              `[ERLC Client] HTTP 429 received. Respecting Retry-After and retrying in ${Math.round(
                retryAfterMs
              )}ms (attempt ${attempt + 1}/${maxRetries + 1}).`
            );
            await this.sleep(retryAfterMs);
            continue;
          }

          return response;
        }

        if (
          (response.status === 502 ||
            response.status === 503 ||
            response.status === 504) &&
          attempt < maxRetries
        ) {
          const delay = this.calculateBackoffDelay(attempt, baseDelay);
          console.warn(
            `[ERLC Client] HTTP ${
              response.status
            } received. Retrying in ${Math.round(delay)}ms (attempt ${
              attempt + 1
            }/${maxRetries + 1}).`
          );
          await this.sleep(delay);
          continue;
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
      } catch (err) {
        lastError = err;

        if (attempt < maxRetries && this.isRetryableError(err)) {
          const delay = this.calculateBackoffDelay(attempt, baseDelay);

          console.warn(
            `[ERLC Client] Request failed (attempt ${attempt + 1}/${
              maxRetries + 1
            }): ${err.message}. Retrying in ${Math.round(delay)}ms...`
          );
          await this.sleep(delay);
          continue;
        }

        try {
          Sentry.captureException(err, {
            tags: { module: 'ERLCClient', op: 'http.client' },
            extra: {
              method,
              path,
              url,
              attempt,
              maxRetries,
              message: err?.message,
              name: err?.name,
              code: err?.code,
            },
          });
        } catch {}

        throw err;
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
   * @param {{method?: string, path?: string, url?: string}} [request] - Request context
   * @returns {Promise<*>} Parsed response data
   */
  async handleResponse(response, request = {}) {
    const tryParseJson = (text) => {
      if (!text || typeof text !== 'string') return null;
      const trimmed = text.trim();
      if (!trimmed) return null;
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    };

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

      let rawText;
      try {
        rawText = await response.text();
      } catch {
        rawText = '';
      }

      const parsed = tryParseJson(rawText);
      const errorData =
        parsed && typeof parsed === 'object'
          ? parsed
          : { code: 4001, message: 'Rate limited' };

      const err = PRCAPIError.fromResponse(
        response,
        errorData,
        request,
        rawText
      );
      if (!err.retryAfter) {
        err.retryAfter = retryAfterMs;
      }
      throw err;
    }

    if (!response.ok) {
      let rawText;
      try {
        rawText = await response.text();
      } catch {
        rawText = '';
      }

      const parsed = tryParseJson(rawText);
      const errorData =
        parsed && typeof parsed === 'object'
          ? parsed
          : {
              code: 0,
              message: `HTTP ${response.status}: ${
                response.statusText || 'Error'
              }`,
            };

      throw PRCAPIError.fromResponse(response, errorData, request, rawText);
    }

    try {
      return await response.json();
    } catch (_err) {
      const error = new Error('Failed to parse response JSON');
      error.status = response.status;
      error.statusText = response.statusText;
      error.method = request?.method;
      error.path = request?.path;
      error.url = request?.url || response?.url;
      throw error;
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
      try {
        if (this.cache.store instanceof MemoryCache) {
          this.cache.store.destroy();
        } else if (this.cache.store.disconnect) {
          this.cache.store.disconnect().catch(() => undefined);
        }
      } catch (_err) {}
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
      cache:
        this.cache && this.cache.store instanceof MemoryCache
          ? this.cache.store.getStats()
          : null,
    };

    return status;
  }

  /**
   * Clear the client cache (erlc.ts parity)
   */
  async clearCache() {
    if (!this.cache) return;
    try {
      if (this.cache.store instanceof MemoryCache) {
        this.cache.store.clear();
      } else {
        await this.cache.store.clear();
      }
    } catch {}
  }

  /**
   * Get cache size (erlc.ts parity)
   * @returns {Promise<number>}
   */
  async getCacheSize() {
    if (!this.cache) return 0;
    try {
      if (this.cache.store instanceof MemoryCache) {
        return this.cache.store.size();
      }
      return await this.cache.store.size();
    } catch {
      return 0;
    }
  }

  /**
   * Get a cache entry directly (in-memory only)
   * @param {string} key
   */
  getCacheEntry(key) {
    if (!this.cache) return null;
    if (!(this.cache.store instanceof MemoryCache)) return null;
    const entry = this.cache.store.getRawEntry(key);
    return entry ? entry.value : null;
  }

  /**
   * Get cache keys (in-memory only)
   * @returns {string[]}
   */
  getCacheKeys() {
    if (!this.cache) return [];
    if (!(this.cache.store instanceof MemoryCache)) return [];
    return this.cache.store.getAllKeys();
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
