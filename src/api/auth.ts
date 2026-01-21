import crypto from 'crypto';

/**
 * Polymarket L2 Authentication
 * Generates HMAC-SHA256 signatures for authenticated API requests
 */

export interface PolymarketCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  address: string;
}

export interface AuthHeaders {
  POLY_ADDRESS: string;
  POLY_SIGNATURE: string;
  POLY_TIMESTAMP: string;
  POLY_API_KEY: string;
  POLY_PASSPHRASE: string;
}

/**
 * Generate HMAC-SHA256 signature for Polymarket API
 * Message format: timestamp + method + path (+ body if present)
 */
function generateSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body?: string
): string {
  // Construct message: timestamp + method + path + body
  let message = timestamp + method.toUpperCase() + path;
  if (body) {
    message += body;
  }

  // Decode base64 secret
  const secretBuffer = Buffer.from(secret, 'base64');

  // Generate HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secretBuffer);
  hmac.update(message);
  const signature = hmac.digest('base64');

  // Convert to URL-safe base64 (replace + with -, / with _)
  return signature.replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Build authentication headers for an API request
 */
export function buildAuthHeaders(
  credentials: PolymarketCredentials,
  method: string,
  path: string,
  body?: string
): AuthHeaders {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const signature = generateSignature(
    credentials.apiSecret,
    timestamp,
    method,
    path,
    body
  );

  return {
    POLY_ADDRESS: credentials.address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_API_KEY: credentials.apiKey,
    POLY_PASSPHRASE: credentials.passphrase,
  };
}

/**
 * Check if credentials are configured
 */
export function hasCredentials(creds: {
  apiKey: string | null;
  apiSecret: string | null;
  passphrase: string | null;
  address: string | null;
}): creds is PolymarketCredentials {
  return !!(creds.apiKey && creds.apiSecret && creds.passphrase && creds.address);
}
