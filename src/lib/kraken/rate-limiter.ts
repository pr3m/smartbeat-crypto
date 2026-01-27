/**
 * Kraken API Rate Limiter
 *
 * Implements rate limiting with exponential backoff for Kraken API calls.
 * Kraken starter tier allows ~15 calls per 3-second decay period.
 */

export interface RateLimiterConfig {
  maxCallsPerPeriod: number;    // 15 for starter tier
  periodMs: number;              // 3000ms decay period
  minDelayMs: number;            // 200ms minimum between calls
  maxRetries: number;            // Maximum retry attempts
  baseBackoffMs: number;         // Starting backoff delay
  maxBackoffMs: number;          // Maximum backoff delay
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxCallsPerPeriod: 15,
  periodMs: 3000,
  minDelayMs: 200,
  maxRetries: 5,
  baseBackoffMs: 1000,
  maxBackoffMs: 16000,
};

// Error messages that indicate rate limiting
const RATE_LIMIT_ERRORS = [
  'EAPI:Rate limit exceeded',
  'EGeneral:Too many requests',
  'EService:Unavailable',
  'EService:Busy',
];

export class KrakenRateLimiter {
  private config: RateLimiterConfig;
  private callTimestamps: number[] = [];
  private consecutiveErrors: number = 0;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Wait until it's safe to make another API call
   */
  async throttle(): Promise<void> {
    const now = Date.now();

    // Clean up old timestamps outside the period window
    const cutoff = now - this.config.periodMs;
    this.callTimestamps = this.callTimestamps.filter(t => t > cutoff);

    // Check if we need to wait
    if (this.callTimestamps.length >= this.config.maxCallsPerPeriod) {
      // Wait until the oldest call falls outside the window
      const oldestCall = this.callTimestamps[0];
      const waitTime = oldestCall + this.config.periodMs - now + this.getJitter();

      if (waitTime > 0) {
        await this.sleep(waitTime);
      }
    } else if (this.callTimestamps.length > 0) {
      // Ensure minimum delay between calls
      const lastCall = this.callTimestamps[this.callTimestamps.length - 1];
      const elapsed = now - lastCall;

      if (elapsed < this.config.minDelayMs) {
        await this.sleep(this.config.minDelayMs - elapsed + this.getJitter());
      }
    }

    // If we've had consecutive errors, add extra backoff
    if (this.consecutiveErrors > 0) {
      const backoff = this.calculateBackoff(this.consecutiveErrors);
      await this.sleep(backoff);
    }

    // Record this call
    this.callTimestamps.push(Date.now());
  }

  /**
   * Execute a function with automatic retry on rate limit errors
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      // Check for abort
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      try {
        // Wait for rate limit window
        await this.throttle();

        // Execute the function
        const result = await fn();

        // Success - reset consecutive errors
        this.consecutiveErrors = 0;
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if it's a rate limit error
        if (this.isRateLimitError(lastError)) {
          this.consecutiveErrors++;

          // Calculate backoff with jitter
          const backoff = this.calculateBackoff(attempt + 1);
          console.warn(
            `Kraken rate limit hit (attempt ${attempt + 1}/${this.config.maxRetries + 1}), ` +
            `backing off for ${backoff}ms`
          );

          // Wait before retrying
          await this.sleep(backoff);
          continue;
        }

        // Non-rate-limit error - don't retry
        throw lastError;
      }
    }

    // All retries exhausted
    throw lastError || new Error('Rate limit retries exhausted');
  }

  /**
   * Check if an error is a rate limit error
   */
  isRateLimitError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return RATE_LIMIT_ERRORS.some(
      rateLimitMsg => message.includes(rateLimitMsg.toLowerCase())
    );
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attempt: number): number {
    // Exponential backoff: base * 2^attempt
    const exponentialDelay = this.config.baseBackoffMs * Math.pow(2, attempt - 1);

    // Cap at max backoff
    const cappedDelay = Math.min(exponentialDelay, this.config.maxBackoffMs);

    // Add jitter (0-25% of delay)
    return cappedDelay + this.getJitter(cappedDelay * 0.25);
  }

  /**
   * Get random jitter value
   */
  private getJitter(maxJitter: number = 50): number {
    return Math.floor(Math.random() * maxJitter);
  }

  /**
   * Sleep for specified milliseconds with abort support
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset the rate limiter state (useful after long pauses)
   */
  reset(): void {
    this.callTimestamps = [];
    this.consecutiveErrors = 0;
  }

  /**
   * Get current state for debugging
   */
  getStats(): { callsInWindow: number; consecutiveErrors: number } {
    const now = Date.now();
    const cutoff = now - this.config.periodMs;
    const recentCalls = this.callTimestamps.filter(t => t > cutoff);

    return {
      callsInWindow: recentCalls.length,
      consecutiveErrors: this.consecutiveErrors,
    };
  }
}

// Export a default singleton instance
export const krakenRateLimiter = new KrakenRateLimiter();

// Export factory for custom configs
export function createRateLimiter(config?: Partial<RateLimiterConfig>): KrakenRateLimiter {
  return new KrakenRateLimiter(config);
}
