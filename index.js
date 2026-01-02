const {
  ERLCClient,
  createClient,
  getFriendlyErrorMessage,
} = require('./client');
const {
  EventType,
  ErrorCode,
  isPrivateServerOfflineError,
} = require('./types');
const { RateLimiter } = require('./rateLimiter');
const { RequestQueue } = require('./queue');
const { MemoryCache } = require('./cache');
const { Subscription, getDefaultEventConfig } = require('./subscription');
const { PRCAPIError } = require('./errors');
const { PRCHelpers } = require('./helpers');

/**
 * Create a new ERLC client with default configuration
 * @param {string} apiKey - The API key
 * @param {ClientOptions} [options] - Optional client configuration
 * @returns {ERLCClient} New ERLC client instance
 */
function newClient(apiKey, options = {}) {
  return createClient(apiKey, options);
}

/**
 * Create a new ERLC client with request queue enabled
 * @param {string} apiKey - The API key
 * @param {number} [workers=1] - Number of queue workers
 * @param {number} [interval=1000] - Interval between requests in milliseconds
 * @param {ClientOptions} [options] - Additional client options
 * @returns {ERLCClient} New ERLC client instance with queue
 */
function newClientWithQueue(
  apiKey,
  workers = 1,
  interval = 1000,
  options = {}
) {
  return createClient(apiKey, {
    ...options,
    requestQueue: {
      workers,
      interval,
    },
  });
}

/**
 * Create a new ERLC client with caching enabled
 * @param {string} apiKey - The API key
 * @param {number} [ttl=60000] - Cache TTL in milliseconds
 * @param {ClientOptions} [options] - Additional client options
 * @returns {ERLCClient} New ERLC client instance with cache
 */
function newClientWithCache(apiKey, ttl = 60000, options = {}) {
  return createClient(apiKey, {
    ...options,
    cache: {
      enabled: true,
      ttl,
      staleIfError: true,
      maxItems: 1000,
      prefix: 'erlc:',
      ...(options.cache && typeof options.cache === 'object'
        ? {
            redisUrl: options.cache.redisUrl,
            redisKeyPrefix: options.cache.redisKeyPrefix,
          }
        : {}),
    },
  });
}

/**
 * Create a new ERLC client with both queue and cache
 * @param {string} apiKey - The API key
 * @param {Object} [config] - Configuration object
 * @param {number} [config.workers=1] - Number of queue workers
 * @param {number} [config.interval=1000] - Interval between requests
 * @param {number} [config.ttl=60000] - Cache TTL in milliseconds
 * @param {string} [config.redisUrl] - Optional Redis URL (enables Redis cache)
 * @param {string} [config.redisKeyPrefix] - Optional Redis key prefix
 * @param {ClientOptions} [options] - Additional client options
 * @returns {ERLCClient} New ERLC client instance with queue and cache
 */
function newClientWithQueueAndCache(apiKey, config = {}, options = {}) {
  const {
    workers = 1,
    interval = 1000,
    ttl = 60000,
    redisUrl,
    redisKeyPrefix,
  } = config;

  return createClient(apiKey, {
    ...options,
    requestQueue: {
      workers,
      interval,
    },
    cache: {
      enabled: true,
      ttl,
      staleIfError: true,
      maxItems: 1000,
      prefix: 'erlc:',
      ...(redisUrl ? { redisUrl } : {}),
      ...(redisKeyPrefix ? { redisKeyPrefix } : {}),
    },
  });
}

module.exports = {
  ERLCClient,
  createClient,
  newClient,
  newClientWithQueue,
  newClientWithCache,
  newClientWithQueueAndCache,

  getFriendlyErrorMessage,
  isPrivateServerOfflineError,
  EventType,
  ErrorCode,
  getDefaultEventConfig,

  PRCAPIError,
  PRCHelpers,

  RateLimiter,
  RequestQueue,
  MemoryCache,
  Subscription,
};
