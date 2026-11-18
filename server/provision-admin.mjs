import { openDatabase } from './database.mjs';
import { databasePath } from './config.mjs';
import { provisionAdministrator } from './admin-account.mjs';

process.umask(0o077);
const store = openDatabase(databasePath());
try {
  await provisionAdministrator(store, {
    email: process.env.LIFELINK_ADMIN_EMAIL?.trim().toLowerCase(),
    name: process.env.LIFELINK_ADMIN_NAME?.trim(),
    password: process.env.LIFELINK_ADMIN_PASSWORD
  });
  console.log('Administrator created by the server operator.');
} finally {
  store.db.close();
}
