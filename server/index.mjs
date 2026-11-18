import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { hasAdministrator, provisionAdministrator } from './admin-account.mjs';
import { databasePath } from './config.mjs';
import { openDatabase } from './database.mjs';
import { siteHeaders, pages } from './http-security.mjs';
import { createOperations } from './operations.mjs';
import { cookieName, digest, HttpError, limit, sessionCookie, token } from './security.mjs';

const root = new URL('../', import.meta.url);
const fileTypes = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
const staticFiles = new Map([
  ...pages.map(name => name + '.html'),
  'css/style.css', 'css/theme-editorial.css', 'vendor/chart.umd.min.js',
  'js/auth.js', 'js/ui.js', 'js/db.js', 'js/admin.js', 'js/donor.js', 'js/find.js'
].map(name => ['/' + name, [fileTypes[name.split('.').at(-1)], readFileSync(new URL(name, root))]]));

function writeJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Expected a JSON request.');
  }
  const maxBytes = 8192;
  if (Number(req.headers['content-length']) > maxBytes) throw new HttpError(413, 'Request is too large.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('Bad input');
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

export function createApp(store, { production = false, origins = [], railway = false, reservedEmail } = {}) {
  const operations = createOperations(store, { reservedEmail });
  const allowedOrigins = new Set(origins);
  const headers = siteHeaders(root);
  const cookie = cookieName(production);
  if (production) headers['Strict-Transport-Security'] = 'max-age=31536000';

  const cleanup = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    try {
      store.run('DELETE FROM Session WHERE expires_at <= :now', { now });
      store.run('DELETE FROM RateLimit WHERE window_end <= :now', { now });
    } catch {
      console.error('Could not prune expired sessions and rate limits.');
    }
  }, 600e3).unref();

  async function exportDatabase() {
    const dir = await mkdtemp(join(tmpdir(), 'lifelink-backup-'));
    const file = join(dir, 'backup.sqlite');
    try {
      await backup(store.db, file);
      return await readFile(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function handle(req, res) {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    res.setHeader('Cache-Control', 'no-store');
    const path = req.url?.split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      store.one('SELECT 1');
      return writeJson(res, 200, { ok: true });
    }
    if (!path?.startsWith('/api/')) {
      const file = staticFiles.get(path === '/' ? '/index.html' : path);
      if (!file) throw new HttpError(404, 'Page not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      res.writeHead(200, { 'Content-Type': file[0] });
      return res.end(req.method === 'GET' ? file[1] : undefined);
    }

    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    // Browsers must supply their real Origin. API responses never opt into CORS.
    const origin = req.headers.origin;
    const loopback = !production && origin && /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin);
    if (!origin || (!allowedOrigins.has(origin) && !loopback)) {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const operation = operations.get(path.slice('/api/'.length));
    if (!operation) throw new HttpError(404, 'Operation not found.');

    const rawCookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookie + '='));
    const previous = rawCookie?.slice(cookie.length + 1);
    const tokenHash = previous && /^[\w-]{43}$/.test(previous) ? digest(previous) : null;
    const body = await readJson(req);
    const [permission, execute] = operation;
    const authorize = () => {
      const now = Math.floor(Date.now() / 1000);
      const user = tokenHash ? store.one(`
        SELECT u.user_id, u.full_name, u.role FROM Session s JOIN Users u USING (user_id)
         WHERE s.token_hash = :tokenHash AND s.expires_at > :now`, { tokenHash, now }) : null;
      if (permission !== 'public') {
        if (!user) throw new HttpError(401, 'Please sign in.');
        if (user.role !== permission) throw new HttpError(403, 'Your account cannot perform this action.');
      }
      return user;
    };
    const user = authorize();

    const ip = (railway && req.headers['x-real-ip']) || req.socket.remoteAddress || 'unknown';
    limit(store, 'api', String(ip).slice(0, 128), 300, 60);
    const endSession = () => {
      if (tokenHash) store.run('DELETE FROM Session WHERE token_hash = :tokenHash', { tokenHash });
      res.setHeader('Set-Cookie', sessionCookie(production, '', 0));
    };
    const startSession = (userId, remember) => {
      if (tokenHash) store.run('DELETE FROM Session WHERE token_hash = :tokenHash', { tokenHash });
      const value = token();
      const ttl = remember ? 7 * 86400 : 12 * 3600;
      store.run('INSERT INTO Session VALUES (:hash, :userId, :expires)', { hash: digest(value), userId, expires: Math.floor(Date.now() / 1000) + ttl });
      res.setHeader('Set-Cookie', sessionCookie(production, value, remember ? ttl : undefined));
    };

    const data = await execute({ body, user, ip: String(ip).slice(0, 128), startSession, endSession, exportDatabase, authorize });
    if (Buffer.isBuffer(data)) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="lifelink.sqlite"'
      });
      return res.end(data);
    }
    if (path === '/api/adminReset' && data.ok) endSession();
    return writeJson(res, 200, data);
  }

  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    handle(req, res).catch(error => {
      if (res.headersSent) return res.destroy();
      if (error instanceof HttpError) {
        if (error.status === 429) res.setHeader('Retry-After', '60');
        return writeJson(res, error.status, { ok: false, error: error.message });
      }
      console.error('Request failed', { code: error.code ?? 'internal-error' });
      return writeJson(res, 500, { ok: false, error: 'Something went wrong. Please try again.' });
    });
  });
  server.on('close', () => clearInterval(cleanup));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const railway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID);
  const origins = [
    'https://organ-blood-matching.netlify.app',
    ...((process.env.LIFELINK_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean))
  ];
  if (process.env.RAILWAY_PUBLIC_DOMAIN) origins.push('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);
  const store = openDatabase(databasePath());
  const reservedEmail = process.env.LIFELINK_ADMIN_EMAIL?.trim().toLowerCase();
  if (process.env.LIFELINK_ADMIN_PASSWORD && !hasAdministrator(store)) {
    await provisionAdministrator(store, {
      email: reservedEmail,
      name: process.env.LIFELINK_ADMIN_NAME?.trim() || 'LifeLink Administrator',
      password: process.env.LIFELINK_ADMIN_PASSWORD
    });
    console.log('Administrator created by the server operator.');
  }
  delete process.env.LIFELINK_ADMIN_PASSWORD;
  const production = railway || process.env.NODE_ENV === 'production';
  const server = createApp(store, { production, origins, railway, reservedEmail });
  server.listen(Number(process.env.PORT || 8931), '0.0.0.0', () => console.log('LifeLink is listening.'));
  process.once('SIGTERM', () => server.close(() => store.db.close()));
}
