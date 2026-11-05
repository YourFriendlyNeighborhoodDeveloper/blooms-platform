import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { badRequest } from '../lib/errors.js';

const N = process.env.APP_ENV === 'test' ? 2 ** 10 : 2 ** 17;
const R = 8;
const P = 1;
const LEN = 32;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, LEN, { N: n, r, p, maxmem: 256 * n * r }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** scrypt at OWASP's recommended cost, with parameters stored per hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Spend the same time for an unknown account, so response timing cannot reveal who has one.
    await derive(password, randomBytes(16), N, R, P);
    return false;
  }
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const key = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  const expected = Buffer.from(hash, 'base64url');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function assertStrongPassword(password: string) {
  if (password.length < 12) throw badRequest('Please use at least 12 characters.');
  if (password.length > 200) throw badRequest('Please use at most 200 characters.');
  if (/^(.)\1+$/.test(password) || /^(password|123456|qwerty|blooms)/i.test(password)) {
    throw badRequest('That password is too easy to guess. Please choose another.');
  }
}
