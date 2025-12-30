/**
 * ERLC API Types and Interfaces
 * Based on the bmrgcorp/erlcgo implementation
 */

/**
 * @typedef {Object} ERLCServerPlayer
 * @property {string} Player - The username of the player
 * @property {string} Permission - The player's permission level (e.g., "Admin", "Moderator", "Player")
 * @property {string} Callsign - The player's in-game identifier (e.g., "PC-31")
 * @property {string} Team - The player's current team or department
 */

/**
 * @typedef {Object} ERLCCommandLog
 * @property {string} Player - Player who executed the command
 * @property {number} Timestamp - Unix timestamp of when the command was executed
 * @property {string} Command - Command that was executed
 */

/**
 * @typedef {Object} ERLCModCallLog
 * @property {string} Caller - The player who initiated the call
 * @property {string} Moderator - The moderator who responded to the call
 * @property {number} Timestamp - Unix timestamp of when the call was made
 */

/**
 * @typedef {Object} ERLCKillLog
 * @property {string} Killed - The player who was killed
 * @property {number} Timestamp - Unix timestamp of when the kill occurred
 * @property {string} Killer - The player who made the kill
 */

/**
 * @typedef {Object} ERLCJoinLog
 * @property {boolean} Join - Whether the player joined (true) or left (false) the server
 * @property {number} Timestamp - Unix timestamp of when the join/leave occurred
 * @property {string} Player - The player who joined or left the server
 */

/**
 * @typedef {Object} ERLCVehicle
 * @property {string} Texture - The texture applied to the vehicle
 * @property {string} Name - The name of the vehicle
 * @property {string} Owner - The player who owns the vehicle
 */

/**
 * @typedef {Object} APIError
 * @property {number} code - The numeric error code
 * @property {string} message - The human-readable error description
 * @property {string} [commandId] - The ID of the command that caused the error (if applicable)
 */

/**
 * @typedef {Object} RateLimit
 * @property {string} bucket - The identifier for the rate limit bucket
 * @property {number} limit - The maximum number of requests allowed in the bucket
 * @property {number} remaining - The number of requests remaining in the current rate limit window
 * @property {Date} reset - The time when the rate limit will reset
 */

/**
 * @typedef {Object} CacheConfig
 * @property {boolean} enabled - Determines if caching is enabled
 * @property {number} ttl - The time-to-live for cached items in milliseconds
 * @property {boolean} staleIfError - Determines if stale items should be returned when errors occur
 * @property {number} [maxItems] - Maximum number of items to cache
 * @property {string} [prefix] - Prefix for cache keys
 * @property {string} [redisUrl] - Optional Redis URL for Redis cache backend
 * @property {string} [redisKeyPrefix] - Optional Redis key prefix (e.g. 'erlc:')
 */

/**
 * @typedef {Object} ClientOptions
 * @property {number} [timeout] - Request timeout in milliseconds
 * @property {string} [baseURL] - Custom base URL for the API
 * @property {string} [globalKey] - Optional global key (sent as Authorization)
 * @property {RequestQueueConfig} [requestQueue] - Request queue configuration
 * @property {CacheConfig} [cache] - Cache configuration
 */

/**
 * @typedef {Object} MethodOptions
 * @property {boolean} [cache] - Enable/disable cache for this call
 * @property {number} [cacheMaxAge] - Override cache TTL (ms) for this call
 */

/**
 * @typedef {Object} RequestQueueConfig
 * @property {number} workers - Number of workers to process requests
 * @property {number} interval - Interval between requests in milliseconds
 */

/**
 * Event types for subscriptions
 */
const EventType = {
  PLAYERS: 'players',
  COMMANDS: 'commands',
  KILLS: 'kills',
  MODCALLS: 'modcalls',
  JOINS: 'joins',
  VEHICLES: 'vehicles',
};

/**
 * Enumeration of PRC API error codes.
 */
const ErrorCode = {
  UNKNOWN: 0,
  ROBLOX_ERROR: 1001,
  INTERNAL_ERROR: 1002,
  NO_SERVER_KEY: 2000,
  INVALID_SERVER_KEY_FORMAT: 2001,
  INVALID_SERVER_KEY: 2002,
  INVALID_GLOBAL_KEY: 2003,
  BANNED_SERVER_KEY: 2004,
  INVALID_COMMAND: 3001,
  SERVER_OFFLINE: 3002,
  RATE_LIMITED: 4001,
  RESTRICTED_COMMAND: 4002,
  PROHIBITED_MESSAGE: 4003,
  RESTRICTED_RESOURCE: 9998,
  OUTDATED_MODULE: 9999,
};

/**
 * @typedef {Object} EventConfig
 * @property {number} pollInterval - How often to poll for events in milliseconds
 * @property {number} bufferSize - Size of the event buffer
 * @property {boolean} retryOnError - Whether to retry on errors
 * @property {number} retryInterval - Interval between retries in milliseconds
 * @property {Function} [filterFunc] - Function to filter events
 * @property {boolean} includeInitialState - Whether to include initial state
 * @property {boolean} batchEvents - Whether to batch events
 * @property {number} batchWindow - Window for batching events in milliseconds
 * @property {boolean} logErrors - Whether to log errors
 * @property {Function} [errorHandler] - Custom error handler
 * @property {string} timeFormat - Time format for events
 */

/**
 * @typedef {Object} PlayerEvent
 * @property {ERLCServerPlayer} player - The player data
 * @property {string} type - The event type ('join' or 'leave')
 */

/**
 * @typedef {Object} Event
 * @property {string} type - The event type
 * @property {*} data - The event data
 */

/**
 * @typedef {Object} HandlerRegistration
 * @property {Function} [playerHandler] - Handler for player events
 * @property {Function} [commandHandler] - Handler for command events
 * @property {Function} [killHandler] - Handler for kill events
 * @property {Function} [modCallHandler] - Handler for mod call events
 * @property {Function} [joinHandler] - Handler for join events
 * @property {Function} [vehicleHandler] - Handler for vehicle events
 */

/**
 * Get a friendly error message based on the error code
 * @param {Error|APIError} err - The error object
 * @returns {string} A human-readable error message
 */
function getFriendlyErrorMessage(err) {
  if (err && typeof err === 'object' && 'code' in err) {
    const apiErr = err;
    switch (apiErr.code) {
      case 0:
        return 'An unknown error occurred. If this persists, please contact PRC support.';
      case 1001:
        return 'Failed to communicate with the game server. Please try again in a few minutes.';
      case 1002:
        return 'An internal system error occurred. Please try again later.';
      case 2000:
        return 'No server key provided. Please configure your server key.';
      case 2001:
      case 2002:
        return 'Invalid server key. Please check your configuration.';
      case 2003:
        return 'Invalid API key. Please check your configuration.';
      case 2004:
        return 'This server key has been banned from accessing the API.';
      case 3001:
        return 'Invalid command format. Please check your input.';
      case 3002:
        return 'The server is currently offline (no players). Please try again when players are in the server.';
      case 4001:
        return 'You are being rate limited. Please wait a moment and try again.';
      case 4002:
        return 'This command is restricted and cannot be executed.';
      case 4003:
        return "The message you're trying to send contains prohibited content.";
      case 9998:
        return 'Access to this resource is restricted.';
      case 9999:
        return 'The server module is out of date. Please kick all players and try again.';
      default:
        return apiErr.message || 'An unknown error occurred.';
    }
  }
  return err?.message || 'An unknown error occurred.';
}

/**
 * Determine if an error indicates the private server is offline.
 * @param {unknown} err - Error value to inspect
 * @returns {boolean} True if the error represents an offline private server
 */
function isPrivateServerOfflineError(err) {
  const inspected = new Set();
  let current = err;

  while (current && typeof current === 'object' && !inspected.has(current)) {
    inspected.add(current);

    const code = current.code ?? current?.data?.code;
    const numericCode =
      typeof code === 'string' ? Number.parseInt(code, 10) : code;
    if (numericCode === 3002) {
      return true;
    }

    const message = current.message ?? current?.data?.message;
    if (
      typeof message === 'string' &&
      /server is currently offline/i.test(message)
    ) {
      return true;
    }

    current = current.cause;
  }

  if (typeof err === 'string') {
    return /server is currently offline/i.test(err);
  }

  return false;
}

module.exports = {
  EventType,
  ErrorCode,
  getFriendlyErrorMessage,
  isPrivateServerOfflineError,
};
