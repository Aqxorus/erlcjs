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
   * Get cache entry including stale value (expired) when requested.
   * @param {string} key
   * @param {{allowStale?: boolean}} [options]
   * @returns {{value: *, found: boolean, isStale: boolean}}
   */
  getWithMeta(key, options = {}) {
    const item = this.items.get(key);
    if (!item) {
      this.stats.misses++;
      return { value: null, found: false, isStale: false };
    }

    const expired = item.expiration && Date.now() > item.expiration.getTime();
    if (expired && !options.allowStale) {
      this.items.delete(key);
      this.stats.misses++;
      return { value: null, found: false, isStale: false };
    }

    if (!expired) {
      this.stats.hits++;
      return { value: item.value, found: true, isStale: false };
    }

    this.stats.hits++;
    return { value: item.value, found: true, isStale: true };
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
   * Cache size helper (erlc.ts parity).
   * @returns {number}
   */
  size() {
    return this.items.size;
  }

  /**
   * Get raw entry for debugging.
   * @param {string} key
   * @returns {{value: *, expiration: (Date|null), createdAt: Date}|null}
   */
  getRawEntry(key) {
    return this.items.get(key) || null;
  }

  /**
   * Get all keys (debugging).
   * @returns {string[]}
   */
  getAllKeys() {
    return Array.from(this.items.keys());
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

class RedisCache {
  /**
   * @param {{url: string, keyPrefix?: string}} options
   */
  constructor(options) {
    this.url = options?.url;
    this.keyPrefix = options?.keyPrefix;
    this._clientPromise = null;
    this._client = null;
    this.connectionState = this.url ? 'idle' : 'disabled';
    this.lastError = null;
  }

  _fullKey(rawKey) {
    return this.keyPrefix ? `${this.keyPrefix}${rawKey}` : rawKey;
  }

  async _getClient() {
    if (this._clientPromise) return this._clientPromise;

    this._clientPromise = (async () => {
      let redis;
      try {
        redis = await import('redis');
      } catch (err) {
        this.connectionState = 'error';
        this.lastError = err;
        throw new Error(
          "Redis cache configured but 'redis' dependency is not installed. Install it with `pnpm add redis`."
        );
      }

      this.connectionState = 'connecting';
      this.lastError = null;
      const client = redis.createClient({ url: this.url });
      this._client = client;

      client.on('ready', () => {
        this.connectionState = 'connected';
      });
      client.on('end', () => {
        if (this.connectionState !== 'disabled') {
          this.connectionState = 'disconnected';
        }
      });
      client.on('reconnecting', () => {
        this.connectionState = 'connecting';
      });
      client.on('error', (e) => {
        this.lastError = e;
        this.connectionState = 'error';
      });

      await client.connect();
      this.connectionState = client.isReady ? 'connected' : 'connecting';
      return client;
    })();

    return this._clientPromise;
  }

  getConnectionStatus() {
    return {
      enabled: Boolean(this.url),
      state: this.connectionState,
      isOpen: this._client ? Boolean(this._client.isOpen) : null,
      isReady: this._client ? Boolean(this._client.isReady) : null,
      error: this.lastError
        ? String(this.lastError?.message || this.lastError)
        : null,
    };
  }

  async get(rawKey) {
    const client = await this._getClient();
    const key = this._fullKey(rawKey);
    const data = await client.get(key);
    if (!data) return { value: null, found: false, isStale: false };
    try {
      return { value: JSON.parse(data), found: true, isStale: false };
    } catch {
      return { value: null, found: false, isStale: false };
    }
  }

  async set(rawKey, value, ttlMs) {
    const client = await this._getClient();
    const key = this._fullKey(rawKey);
    const ttlSeconds = Math.max(1, Math.ceil((Number(ttlMs) || 0) / 1000));
    await client.setEx(key, ttlSeconds, JSON.stringify(value));
  }

  async delete(rawKey) {
    const client = await this._getClient();
    const key = this._fullKey(rawKey);
    await client.del(key);
  }

  async clear() {
    const client = await this._getClient();

    if (!this.keyPrefix) {
      await client.flushDb();
      return;
    }

    const pattern = `${this.keyPrefix}*`;
    const keys = [];
    for await (const key of client.scanIterator({
      MATCH: pattern,
      COUNT: 200,
    })) {
      keys.push(key);
    }
    if (keys.length > 0) {
      await client.del(keys);
    }
  }

  async size() {
    const client = await this._getClient();
    if (!this.keyPrefix) {
      const keys = await client.keys('*');
      return keys.length;
    }

    const pattern = `${this.keyPrefix}*`;
    let count = 0;
    for await (const _ of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
      count++;
    }
    return count;
  }

  getRawEntry() {
    throw new Error('Cannot get raw entry from Redis cache');
  }

  getAllKeys() {
    throw new Error('Cannot get all keys from Redis cache');
  }

  async disconnect() {
    if (!this._clientPromise) return;
    const client = await this._clientPromise;
    await client.disconnect();
    this.connectionState = 'disconnected';
  }
}

module.exports = { MemoryCache, RedisCache };
