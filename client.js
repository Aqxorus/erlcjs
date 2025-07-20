/**
 * ERLC API Client
 * Main client class for interacting with the Emergency Response: Liberty County API
 */

const { RateLimiter } = require('./rateLimiter');
const { RequestQueue } = require('./queue');
const { MemoryCache } = require('./cache');
const { Subscription, getDefaultEventConfig } = require('./subscription');
const { getFriendlyErrorMessage } = require('./types');

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

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter();

    // Initialize request queue if configured
    this.queue = null;
    if (options.requestQueue) {
      this.queue = new RequestQueue(
        options.requestQueue.workers,
        options.requestQueue.interval
      );
      this.queue.start();
    }

    // Initialize cache if configured
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

    // Check cache first
    if (this.cache && cacheKey) {
      const cached = this.cache.instance.get(cacheKey);
      if (cached.found) {
        return cached.value;
      }
    }

    const execute = async () => {
      const response = await this.makeRequest('GET', path);

      // Cache successful responses
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
    const url = `${this.baseURL}${path}`;

    // Check rate limits
    if (this.rateLimiter) {
      const { duration, shouldWait } = this.rateLimiter.shouldWait('global');
      if (shouldWait) {
        await this.sleep(duration);
      }
    }

    const options = {
      method,
      headers: {
        'Server-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    };

    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);

    // Update rate limiter from response headers
    if (this.rateLimiter && response.headers) {
      const limit = parseInt(response.headers.get('X-RateLimit-Limit')) || 0;
      const remaining =
        parseInt(response.headers.get('X-RateLimit-Remaining')) || 0;
      const reset = parseInt(response.headers.get('X-RateLimit-Reset')) || 0;

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
  }

  /**
   * Handle API response and errors
   * @param {Response} response - Fetch response
   * @returns {Promise<*>} Parsed response data
   */
  async handleResponse(response) {
    if (response.status === 429) {
      // Rate limited - update rate limiter and throw error
      if (this.rateLimiter) {
        this.rateLimiter.updateFromHeaders(
          'global',
          0,
          0,
          new Date(Date.now() + 5000) // 5 second reset
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
      throw error;
    }

    if (!response.ok) {
      // Try to parse error response
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

    // Parse successful response
    try {
      return await response.json();
    } catch (error) {
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
