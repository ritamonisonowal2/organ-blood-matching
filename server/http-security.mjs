import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hash = value => "'sha256-" + createHash('sha256').update(value).digest('base64') + "'";
export const pages = ['index', 'find', 'register', 'login', 'donor', 'admin', 'reset'];

export function siteHeaders(root) {
  const scripts = new Set();
  const handlers = new Set();
  for (const page of pages) {
    const markup = readFileSync(new URL(page + '.html', root), 'utf8');
    for (const [, code] of markup.matchAll(/<script>([\s\S]*?)<\/script>/g)) scripts.add(hash(code.replace(/\r\n/g, '\n')));
    for (const [, code] of markup.matchAll(/\son[a-z]+="([^"]+)"/gi)) handlers.add(hash(code));
  }

  return {
    'Content-Security-Policy': [
      "default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
      "form-action 'self'", "script-src 'self' " + [...scripts].join(' '),
      "script-src-attr 'unsafe-hashes' " + [...handlers].join(' '),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:"
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}
