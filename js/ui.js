/* ============================================================
   ui.js — small shared helpers used by every page
   ============================================================ */

/** Shorthand getElementById */
function el(id) { return document.getElementById(id); }

/** Escape a value before injecting into HTML. */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** SQLite 'YYYY-MM-DD HH:MM:SS' → readable '03 Nov 2026, 10:14' */
function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d)) return s;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric',
                                     hour: '2-digit', minute: '2-digit' });
}

/** 'YYYY-MM-DD HH:MM:SS' → '03 Nov 2026' */
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ---------- badges ---------- */

const STATUS_LABEL = { pending: 'Pending', matched: 'Matched', fulfilled: 'Fulfilled', cancelled: 'Cancelled' };

function statusBadge(status) {
  const label = STATUS_LABEL[status] || status;
  return `<span class="badge badge-${esc(status)}">${esc(label)}</span>`;
}

function urgencyBadge(urgency) {
  return `<span class="badge badge-urgency-${esc(urgency)}">${esc(urgency === 'critical' ? '🔴 ' : urgency === 'urgent' ? '🟠 ' : '🟢 ')}${esc(urgency)}</span>`;
}

function stockBadge(stockStatus) {
  const map = {
    'OK':  '<span class="badge badge-stock-ok">In stock</span>',
    'LOW': '<span class="badge badge-stock-low">Low stock</span>',
    'OUT': '<span class="badge badge-stock-out">Out of stock</span>'
  };
  return map[stockStatus] || esc(stockStatus);
}

function typeBadge(type) {
  return type === 'blood'
    ? '<span class="badge badge-type-blood">🩸 Blood</span>'
    : '<span class="badge badge-type-organ">🫀 Organ</span>';
}

/** Who/where a request comes from: hospital if given, otherwise the person. */
function reqPlace(r) { return r.hospital_name || r.requester_name || 'Patient family'; }

/* ---------- toasts ---------- */

function toast(message, type) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'info');
  t.innerHTML = message;
  host.appendChild(t);
  setTimeout(() => { t.classList.add('toast-hide'); }, 3600);
  setTimeout(() => { t.remove(); }, 4100);
}

/* ---------- modals ---------- */

function openModal(id)  { const m = el(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = el(id); if (m) m.classList.remove('open'); }

/* Close a modal when clicking the dark backdrop */
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
});

/* ---------- empty states ---------- */

function emptyState(icon, title, hint) {
  return `<div class="empty-state">
            <div class="empty-icon">${icon}</div>
            <div class="empty-title">${esc(title)}</div>
            <div class="empty-hint">${esc(hint)}</div>
          </div>`;
}

/* ---------- page boot helper ---------- */

/**
 * Every page script calls this first: initialises the database,
 * then verifies the session role. Returns the session or
 * redirects to login.html.
 */
async function bootPage(requiredRole) {
  await initDatabase();
  let session = getSession();
  if (session && !sessionUserExists(session)) { clearSession(); session = null; }   // stale after a reset
  if (!session) { location.replace('login.html'); return null; }
  if (requiredRole && session.role !== requiredRole) {
    location.replace(homeForRole(session.role));
    return null;
  }
  mountUserChip();
  return session;
}

function homeForRole(role) {
  return role === 'admin' ? 'admin.html' : 'donor.html';
}

/** Fill the navbar chip with the logged-in user + logout control. */
function mountUserChip() {
  renderNavLinks();
  const slot = el('nav-user');
  if (!slot) return;
  const s = getSession();
  if (!s) { slot.innerHTML = `<a class="btn btn-outline btn-sm" href="login.html">Login</a>`; return; }
  const roleIcon = s.role === 'admin' ? '🛡️' : '🩸';
  slot.innerHTML = `
    <span class="nav-user-chip">${roleIcon} ${esc(s.full_name)}</span>
    <button class="btn btn-ghost btn-sm" onclick="doLogout()">Logout</button>`;
}


/* ============================================================
   Pill navigation — every feature is a tab (same on every page)
   ============================================================ */

const NAV_ICONS = {
  home:     '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  match:    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  stock:    '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  requests: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  analytics:'<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  dash:     '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  register: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>',
  bolt:     '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  arrow:    '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'
};
function navIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[name] || ''}</svg>`;
}

function renderNavLinks() {
  const inner = document.querySelector('.nav-inner');
  if (!inner) return;
  let box = inner.querySelector('.nav-links');
  if (!box) {
    box = document.createElement('div');
    box.className = 'nav-links';
    inner.insertBefore(box, inner.querySelector('.nav-right'));
  }
  const s = getSession();
  const dashHref = s ? homeForRole(s.role) : 'login.html';
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const hash = location.hash;

  const tabs = [
    { key: 'home',      label: 'Home',      href: 'index.html',            icon: 'home' },
    { key: 'find',      label: 'Find Donor', href: 'find.html',            icon: 'match' },
    { key: 'stock',     label: 'Blood Stock', href: 'index.html#stock',    icon: 'stock' },
    { key: 'requests',  label: 'Requests',  href: 'index.html#requests',   icon: 'requests' },
    { key: 'analytics', label: 'Analytics', href: 'index.html#analytics',  icon: 'analytics' },
    { key: 'dash',      label: 'Dashboard', href: dashHref, icon: 'dash' }
  ];
  if (!s) tabs.push({ key: 'register', label: 'Donate', href: 'register.html', icon: 'register' });

  const isActive = t => {
    if (t.key === 'dash')     return page !== 'index.html' && page !== 'register.html' && page !== 'find.html' && (page === dashHref || page === 'login.html');
    if (t.key === 'find')     return page === 'find.html';
    if (t.key === 'register') return page === 'register.html';
    if (page !== 'index.html') return false;
    if (t.key === 'home')     return !hash || hash === '#';
    return hash === '#' + t.key;
  };

  box.innerHTML = tabs.map(t =>
    `<a href="${t.href}" class="${isActive(t) ? 'active' : ''}">${navIcon(t.icon)}<span>${t.label}</span></a>`
  ).join('');

  if (!window.__navHashBound) {
    window.__navHashBound = true;
    window.addEventListener('hashchange', renderNavLinks);
  }
}
