/**
 * Memory Cache implementation for ERLC API
 * Provides caching with TTL support and memory management
 */

class MemoryCache {
  /**
   * @param {number} maxItems - Maximum number of items to cache
   */
  constructor(maxItems = 1000) {
    this.items = new Map();
    this.maxItems = maxItems;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
    };
    this.onEvict = null;

    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Get a value from the cache
   * @param {string} key - Cache key
   * @returns {{value: *, found: boolean}} Cached value and whether it was found
   */
  get(key) {
    const item = this.items.get(key);

    if (!item) {
      this.stats.misses++;
      return { value: null, found: false };
    }

    if (item.expiration && Date.now() > item.expiration.getTime()) {
      this.items.delete(key);
      this.stats.misses++;
      return { value: null, found: false };
    }

    this.stats.hits++;
    return { value: item.value, found: true };
  }

  /**
   * Set a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds
   */
  set(key, value, ttl) {
    let expiration = null;
    if (ttl > 0) {
      expiration = new Date(Date.now() + ttl);
    }

    if (this.items.size >= this.maxItems && !this.items.has(key)) {
      this.evictOldest();
    }

    this.items.set(key, {
      value,
      expiration,
      createdAt: new Date(),
    });

    this.stats.sets++;
  }

  /**
   * Delete a value from the cache
   * @param {string} key - Cache key
   */
  delete(key) {
    const deleted = this.items.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
  }

  /**
   * Clear all items from the cache
   */
  clear() {
    const count = this.items.size;
    this.items.clear();
    this.stats.deletes += count;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      ...this.stats,
      size: this.items.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
    };
  }

  /**
   * Set eviction callback
   * @param {Function} fn - Callback function called when items are evicted
   */
  setEvictionCallback(fn) {
    this.onEvict = fn;
  }

  /**
   * Evict the oldest item from cache
   */
  evictOldest() {
    if (this.items.size === 0) return;

    const firstKey = this.items.keys().next().value;
    const item = this.items.get(firstKey);

    this.items.delete(firstKey);
    this.stats.evictions++;

    if (this.onEvict) {
      this.onEvict(firstKey, item.value);
    }
  }

  /**
   * Clean up expired items
   */
  cleanup() {
    const now = Date.now();
    const toDelete = [];

    for (const [key, item] of this.items) {
      if (item.expiration && now > item.expiration.getTime()) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.items.delete(key);
      this.stats.evictions++;
    }
  }

  /**
   * Destroy the cache and cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

module.exports = { MemoryCache };
