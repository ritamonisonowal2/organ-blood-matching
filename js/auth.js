/* The API sets and revokes the session cookie. This is display state only. */
let currentUser = null;

function getSession() {
  return currentUser;
}

async function initDatabase() {
  currentUser = await api('session');
}

async function loginUser(email, password, remember) {
  const result = await action('login', { email, password, remember });
  if (result.ok) currentUser = result.user;
  return result;
}

async function doLogout() {
  const result = await action('logout');
  if (!result.ok) {
    toast(esc(result.error), 'error');
    return;
  }
  currentUser = null;
  location.href = 'index.html';
}
