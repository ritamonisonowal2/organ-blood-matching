import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function databasePath() {
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (process.env.RAILWAY_ENVIRONMENT_ID && !volume) {
    throw new Error('Attach a persistent Railway volume before starting LifeLink.');
  }
  if (volume && process.env.LIFELINK_DB_PATH) {
    throw new Error('Use the mounted Railway volume for the production database.');
  }
  const path = volume
    ? join(realpathSync(volume), 'lifelink.sqlite')
    : resolve(process.env.LIFELINK_DB_PATH || 'data/lifelink.sqlite');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return path;
}
