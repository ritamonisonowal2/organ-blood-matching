/* ============================================================
   auth.js — session handling and role-based access control
   ============================================================ */

const SESSION_KEY = 'lifelink_session';

function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Persist the session. remember=true → localStorage (survives browser restarts);
 * remember=false → sessionStorage (this tab only).
 */
function setSession(user, remember = true) {
  const payload = JSON.stringify({
    user_id:   user.user_id,
    role:      user.role,
    full_name: user.full_name,
    email:     user.email
  });
  if (remember) localStorage.setItem(SESSION_KEY, payload);
  else          sessionStorage.setItem(SESSION_KEY, payload);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function doLogout() {
  clearSession();
  location.href = 'index.html';
}
