import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pages, siteHeaders } from './http-security.mjs';

const root = new URL('../', import.meta.url);
const api = new URL(process.env.LIFELINK_API_URL || 'https://unconfigured.invalid');
if (api.protocol !== 'https:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('LIFELINK_API_URL must be an HTTPS origin without credentials or a path.');
}
if (process.env.CONTEXT === 'production' && api.hostname === 'unconfigured.invalid') {
  throw new Error('Set LIFELINK_API_URL to the LifeLink Railway service origin before publishing.');
}

const files = [
  ...pages.map(name => name + '.html'),
  'css/style.css', 'css/theme-editorial.css', 'vendor/chart.umd.min.js',
  'js/auth.js', 'js/ui.js', 'js/db.js', 'js/admin.js', 'js/donor.js', 'js/find.js'
];
rmSync(new URL('dist/', root), { recursive: true, force: true });
for (const file of files) {
  mkdirSync(new URL('dist/' + dirname(file) + '/', root), { recursive: true });
  copyFileSync(new URL(file, root), new URL('dist/' + file, root));
}
const headers = { ...siteHeaders(root), 'Strict-Transport-Security': 'max-age=31536000' };
const rules = ['/*', ...Object.entries(headers).map(([key, value]) => '  ' + key + ': ' + value)];
writeFileSync(new URL('dist/_headers', root), rules.join('\n') + '\n');
if (api.hostname !== 'unconfigured.invalid') {
  writeFileSync(new URL('dist/_redirects', root), '/api/*  ' + api.origin + '/api/:splat  200!\n');
}
