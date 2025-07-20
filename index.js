/**
 * ERLC API Wrapper
 * A comprehensive JavaScript wrapper for the Emergency Response: Liberty County API
 * Based on the bmrgcorp/erlcgo implementation
 */

const {
  ERLCClient,
  createClient,
  getFriendlyErrorMessage,
} = require('./client');
const { EventType } = require('./types');
const { RateLimiter } = require('./rateLimiter');
const { RequestQueue } = require('./queue');
const { MemoryCache } = require('./cache');
const { Subscription, getDefaultEventConfig } = require('./subscription');

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
 * @param {ClientOptions} [options] - Additional client options
 * @returns {ERLCClient} New ERLC client instance with queue and cache
 */
function newClientWithQueueAndCache(apiKey, config = {}, options = {}) {
  const { workers = 1, interval = 1000, ttl = 60000 } = config;

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
    },
  });
}

module.exports = {
  // Main exports
  ERLCClient,
  createClient,
  newClient,
  newClientWithQueue,
  newClientWithCache,
  newClientWithQueueAndCache,

  // Utility exports
  getFriendlyErrorMessage,
  EventType,
  getDefaultEventConfig,

  // Component exports (for advanced usage)
  RateLimiter,
  RequestQueue,
  MemoryCache,
  Subscription,
};
