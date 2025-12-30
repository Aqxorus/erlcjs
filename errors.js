/**
 * PRC API Error utilities
 * Provides a structured error type similar to erlc.ts
 */

const { ErrorCode, isPrivateServerOfflineError } = require('./types');

class PRCAPIError extends Error {
  /**
   * @param {Object} params
   * @param {number} [params.code]
   * @param {string} params.message
   * @param {number} [params.status]
   * @param {string} [params.statusText]
   * @param {number} [params.retryAfter] - Retry after in milliseconds
   * @param {string} [params.method]
   * @param {string} [params.path]
   * @param {string} [params.url]
   * @param {string} [params.responseBody]
   */
  constructor(params) {
    super(params?.message || 'PRC API Error');
    this.name = 'PRCAPIError';

    this.code = params?.code;
    this.status = params?.status;
    this.statusText = params?.statusText;
    this.retryAfter = params?.retryAfter;

    this.method = params?.method;
    this.path = params?.path;
    this.url = params?.url;
    this.responseBody = params?.responseBody;
  }

  static fromResponse(response, body, request = {}, rawText = '') {
    const code = body?.code ?? body?.errorCode ?? 0;
    const message =
      body?.message ||
      `HTTP ${response?.status || 0}: ${response?.statusText || 'Error'}`;

    let retryAfterMs;
    if (typeof body?.retry_after === 'number' && body.retry_after > 0) {
      retryAfterMs = Math.max(0, Math.round(body.retry_after * 1000));
    }

    return new PRCAPIError({
      code,
      message,
      status: response?.status,
      statusText: response?.statusText,
      retryAfter: retryAfterMs,
      method: request?.method,
      path: request?.path,
      url: request?.url || response?.url,
      responseBody: rawText ? rawText.slice(0, 1024) : undefined,
    });
  }

  get isRateLimit() {
    return this.code === ErrorCode.RATE_LIMITED || this.status === 429;
  }

  get isServerOffline() {
    return (
      this.code === ErrorCode.SERVER_OFFLINE ||
      isPrivateServerOfflineError(this)
    );
  }

  get isAuthError() {
    return [
      ErrorCode.NO_SERVER_KEY,
      ErrorCode.INVALID_SERVER_KEY_FORMAT,
      ErrorCode.INVALID_SERVER_KEY,
      ErrorCode.INVALID_GLOBAL_KEY,
      ErrorCode.BANNED_SERVER_KEY,
    ].includes(this.code);
  }

  get isRetryable() {
    return [
      ErrorCode.ROBLOX_ERROR,
      ErrorCode.INTERNAL_ERROR,
      ErrorCode.RATE_LIMITED,
      ErrorCode.SERVER_OFFLINE,
    ].includes(this.code);
  }
}

module.exports = {
  PRCAPIError,
};
