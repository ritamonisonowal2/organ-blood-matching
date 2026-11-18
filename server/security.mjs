import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const scryptOptions = { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 };
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
let hashesInFlight = 0;

async function deriveKey(password, salt) {
  if (hashesInFlight >= 2) throw new HttpError(503, 'Server is busy. Please try again shortly.');
  hashesInFlight += 1;
  try {
    return await derive(password, salt, 64, scryptOptions);
  } finally {
    hashesInFlight -= 1;
  }
}

export const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = value => typeof value === 'string' && value.length <= 254 && emailPattern.test(value);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await deriveKey(password, salt);
  return salt + ':' + hash.toString('hex');
}

export async function passwordMatches(password, saved) {
  const fallback = '0'.repeat(32) + ':' + '0'.repeat(128);
  const [salt, hash] = (saved || fallback).split(':');
  const bytes = await deriveKey(password, salt);
  return timingSafeEqual(bytes, Buffer.from(hash, 'hex')) && Boolean(saved);
}

export function limit(store, bucket, key, maximum, seconds) {
  const now = Math.floor(Date.now() / 1000);
  const result = store.one(`
    INSERT INTO RateLimit (bucket, key_hash, window_end, hits) VALUES (:bucket, :key, :end, 1)
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
      hits = CASE WHEN window_end <= :now THEN 1 ELSE hits + 1 END,
      window_end = CASE WHEN window_end <= :now THEN :end ELSE window_end END
    RETURNING hits`, { bucket, key: digest(key), now, end: now + seconds });
  if (result.hits > maximum) throw new HttpError(429, 'Too many attempts. Please try again later.');
}

export function cookieName(production) {
  return production ? '__Host-lifelink_session' : 'lifelink_session_dev';
}

export function sessionCookie(production, value, maxAge) {
  const secure = production ? '; Secure' : '';
  const expiry = maxAge === undefined ? '' : '; Max-Age=' + maxAge;
  return cookieName(production) + '=' + value + '; Path=/; HttpOnly; SameSite=Strict' + secure + expiry;
}
