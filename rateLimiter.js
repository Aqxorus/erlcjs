/**
 * Rate Limiter for ERLC API
 * Manages rate limits for different buckets with automatic backoff
 */

class RateLimiter {
  constructor() {
    /** @type {Map<string, RateLimit>} */
    this.limits = new Map();
  }

  /**
   * Update rate limit information from response headers
   * @param {string} bucket - The rate limit bucket identifier
   * @param {number} limit - Maximum number of requests allowed
   * @param {number} remaining - Number of requests remaining
   * @param {Date} reset - When the rate limit resets
   */
  updateFromHeaders(bucket, limit, remaining, reset) {
    this.limits.set(bucket, {
      bucket,
      limit,
      remaining,
      reset,
    });
  }

  /**
   * Check if we should wait before making a request
   * @param {string} bucket - The rate limit bucket identifier
   * @returns {{duration: number, shouldWait: boolean}} Wait duration and whether to wait
   */
  shouldWait(bucket) {
    const limit = this.limits.get(bucket);
    if (!limit) {
      return { duration: 0, shouldWait: false };
    }

    if (limit.remaining <= 0) {
      const wait = limit.reset.getTime() - Date.now();
      if (wait > 0) {
        return { duration: wait, shouldWait: true };
      }
    }

    return { duration: 0, shouldWait: false };
  }

  /**
   * Get current rate limit status for a bucket
   * @param {string} bucket - The rate limit bucket identifier
   * @returns {RateLimit|null} Current rate limit status
   */
  getStatus(bucket) {
    return this.limits.get(bucket) || null;
  }

  /**
   * Clear rate limit data for a bucket
   * @param {string} bucket - The rate limit bucket identifier
   */
  clear(bucket) {
    this.limits.delete(bucket);
  }

  /**
   * Clear all rate limit data
   */
  clearAll() {
    this.limits.clear();
  }
}

module.exports = { RateLimiter };
