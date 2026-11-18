import { hashPassword, validEmail, validPassword } from './security.mjs';

export function hasAdministrator(store) {
  return Boolean(store.one("SELECT user_id FROM Users WHERE role = 'admin' LIMIT 1"));
}

export async function provisionAdministrator(store, { email, name, password }) {
  if (!validEmail(email) || !name || name.length < 2 || name.length > 100 || !validPassword(password)) {
    throw new Error('Provide a valid administrator email, name, and password (12 to 128 characters).');
  }
  const hash = await hashPassword(password);
  store.transaction(() => {
    if (hasAdministrator(store)) throw new Error('An administrator already exists. No account was changed.');
    if (store.one('SELECT user_id FROM Users WHERE email = :email', { email })) {
      throw new Error('The email is already registered. No account was promoted.');
    }
    store.run("INSERT INTO Users (full_name, email, password, role) VALUES (:name, :email, :hash, 'admin')",
      { name, email, hash });
  });
}
