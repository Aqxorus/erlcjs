import type { RateLimit } from './types.js';

export class RateLimiter {
  private limits: Map<string, RateLimit>;

  constructor() {
    this.limits = new Map();
  }

  updateFromHeaders(
    bucket: string,
    limit: number,
    remaining: number,
    reset: Date
  ): void {
    this.limits.set(bucket, {
      bucket,
      limit,
      remaining,
      reset,
    });
  }

  shouldWait(bucket: string): { duration: number; shouldWait: boolean } {
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

  getStatus(bucket: string): RateLimit | null {
    return this.limits.get(bucket) || null;
  }

  clear(bucket: string): void {
    this.limits.delete(bucket);
  }

  clearAll(): void {
    this.limits.clear();
  }
}
