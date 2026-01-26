/**
 * Kraken API Authentication
 * HMAC-SHA512 signing for private endpoints
 *
 * Signature = HMAC-SHA512(urlPath + SHA256(nonce + postData), base64Decode(privateKey))
 */

import { createHmac, createHash } from 'crypto';

// Nonce must be strictly increasing for each request
// Use BigInt for microsecond precision to handle concurrent requests
let lastNonce = BigInt(0);

/**
 * Generate a nonce that is always increasing
 * Uses microseconds (Date.now() * 1000) plus a counter for uniqueness
 * when multiple requests happen within the same microsecond
 */
export function generateNonce(): string {
  // Use microseconds for more granularity
  const now = BigInt(Date.now()) * BigInt(1000);
  // Ensure strictly increasing even if called multiple times in same microsecond
  lastNonce = now > lastNonce ? now : lastNonce + BigInt(1);
  return lastNonce.toString();
}

/**
 * Create HMAC-SHA512 signature for Kraken private API requests
 *
 * @param urlPath - The API path (e.g., "/0/private/Balance")
 * @param postData - URL-encoded POST data
 * @param nonce - The nonce used in the request
 * @param privateKey - Base64-encoded private API key
 */
export function createSignature(
  urlPath: string,
  postData: string,
  nonce: string,
  privateKey: string
): string {
  // Decode the private key from base64
  const privateKeyBuffer = Buffer.from(privateKey, 'base64');

  // Create SHA256 hash of (nonce + postData)
  const sha256Hash = createHash('sha256')
    .update(nonce + postData)
    .digest();

  // Create the message to sign: urlPath + sha256Hash
  const message = Buffer.concat([
    Buffer.from(urlPath),
    sha256Hash
  ]);

  // Create HMAC-SHA512 signature
  const signature = createHmac('sha512', privateKeyBuffer)
    .update(message)
    .digest('base64');

  return signature;
}

/**
 * Create headers for authenticated Kraken API request
 */
export function createAuthHeaders(
  urlPath: string,
  postData: string,
  nonce: string,
  apiKey: string,
  privateKey: string
): Record<string, string> {
  const signature = createSignature(urlPath, postData, nonce, privateKey);

  return {
    'API-Key': apiKey,
    'API-Sign': signature,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

/**
 * Format POST data with nonce
 */
export function formatPostData(
  nonce: string,
  params: Record<string, string | number | undefined> = {}
): string {
  const data = new URLSearchParams();
  data.append('nonce', nonce);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      data.append(key, String(value));
    }
  }

  return data.toString();
}
