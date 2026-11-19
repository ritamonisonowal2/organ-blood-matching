/* ============================================================
   ui.js — small shared helpers used by every page
   ============================================================ */

/* Loaded in the head so the saved appearance applies before the first paint. */
const APPEARANCE_KEY = 'lifelink-appearance';
const deviceAppearance = window.matchMedia('(prefers-color-scheme: dark)');
let appearanceChoice = 'light';
try {
  const saved = localStorage.getItem(APPEARANCE_KEY);
  if (['light', 'dark', 'system'].includes(saved)) appearanceChoice = saved;
} catch { /* Appearance still works when browser storage is unavailable. */ }

function currentAppearance() {
  return appearanceChoice === 'system' ? (deviceAppearance.matches ? 'dark' : 'light') : appearanceChoice;
}

function syncAppearanceControls() {
  const dark = currentAppearance() === 'dark';
  const button = document.querySelector('.theme-toggle');
  if (button) {
    const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
    button.setAttribute('aria-label', 'Dark theme');
    button.setAttribute('aria-checked', String(dark));
    button.title = label;
    button.innerHTML = '<span class="theme-thumb" aria-hidden="true"></span>'
      + '<svg class="theme-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>'
      + '<svg class="theme-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/></svg>';
  }
  const device = document.getElementById('device-theme');
  if (device) device.checked = appearanceChoice === 'system';
  const status = document.getElementById('appearance-status');
  if (status) status.textContent = appearanceChoice === 'system'
    ? `Following your device's ${dark ? 'dark' : 'light'} theme.`
    : `${dark ? 'Dark' : 'Light'} theme saved for this browser.`;
}

function applyAppearance() {
  const theme = currentAppearance();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = theme;
  syncAppearanceControls();
  document.dispatchEvent(new CustomEvent('lifelink:themechange', { detail: { theme } }));
}

function setAppearance(choice) {
  if (!['light', 'dark', 'system'].includes(choice)) return;
  appearanceChoice = choice;
  try { localStorage.setItem(APPEARANCE_KEY, choice); } catch { /* Keep the choice for this page. */ }
  applyAppearance();
}

applyAppearance();
deviceAppearance.addEventListener('change', () => {
  if (appearanceChoice === 'system') applyAppearance();
});
window.addEventListener('storage', event => {
  if (event.key !== APPEARANCE_KEY && event.key !== null) return;
  appearanceChoice = ['light', 'dark', 'system'].includes(event.newValue) ? event.newValue : 'light';
  applyAppearance();
});

function chartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const value = name => styles.getPropertyValue(name).trim();
  return {
    ink: value('--ink'), text: value('--brown-soft'), grid: value('--line'), surface: value('--card'),
    accent: value('--accent'), secondary: value('--chart-secondary'), pending: value('--yellow'),
    matched: value('--blue'), fulfilled: value('--green'), cancelled: value('--muted'), danger: value('--red')
  };
}

function updateChartAppearance(chart) {
  if (!chart) return;
  const theme = chartTheme();
  chart.options.color = theme.text;
  if (chart.options.plugins.legend) chart.options.plugins.legend.labels.color = theme.text;
  for (const scale of Object.values(chart.options.scales || {})) {
    scale.ticks = { ...scale.ticks, color: theme.text };
    scale.grid = { ...scale.grid, color: theme.grid };
    scale.border = { ...scale.border, color: theme.grid };
  }
  chart.stop();
  chart.update('none');
}

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
  if (isNaN(d)) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric',
                                     hour: '2-digit', minute: '2-digit' });
}

/** 'YYYY-MM-DD HH:MM:SS' → '03 Nov 2026' */
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d)) return '—';
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
  const session = getSession();
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
    <button class="btn btn-ghost btn-sm" type="button">Logout</button>`;
  slot.querySelector('button').addEventListener('click', doLogout);
}


/* Shared navigation disclosure, with the same destinations on every page. */

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
  inner.closest('nav').setAttribute('aria-label', 'Main navigation');
  const drop = inner.querySelector('.brand .drop');
  if (drop) drop.innerHTML = navIcon('stock');
  let box = inner.querySelector('.nav-links');
  if (!box) {
    box = document.createElement('div');
    box.className = 'nav-links';
    inner.insertBefore(box, inner.querySelector('.nav-right'));
  }
  const s = getSession();
  const dashHref = s ? homeForRole(s.role) : 'login.html';
  const page = ((location.pathname.split('/').pop() || 'index').replace(/\.html$/i, '') + '.html').toLowerCase();
  const hash = location.hash;

  const tabs = [
    { key: 'home',      label: 'Home',      href: 'index.html',            icon: 'home' },
    { key: 'find',      label: 'Find Donor', href: 'find.html',            icon: 'match' },
    { key: 'stock',     label: 'Blood Stock', href: 'index.html#stock',    icon: 'stock' },
    { key: 'requests',  label: 'Requests',  href: 'index.html#requests',   icon: 'requests' },
    { key: 'analytics', label: 'Analytics', href: 'index.html#analytics',  icon: 'analytics' },
    { key: 'dash',      label: s ? 'Dashboard' : 'Log in', href: dashHref, icon: 'dash' }
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
    `<a href="${t.href}" class="${isActive(t) ? 'active' : ''}"${isActive(t) ? ' aria-current="page"' : ''}>${navIcon(t.icon)}<span>${t.label}</span></a>`
  ).join('');
  if (s) {
    box.insertAdjacentHTML('beforeend', `<button type="button" class="nav-logout">${navIcon('arrow')}<span>Log out</span></button>`);
    box.querySelector('.nav-logout').addEventListener('click', doLogout);
  }
  box.insertAdjacentHTML('beforeend', `
    <div class="appearance-settings">
      <p class="appearance-label">Appearance</p>
      <label class="device-theme-label"><input type="checkbox" id="device-theme"> Use device theme</label>
      <p class="appearance-status" id="appearance-status" aria-live="polite"></p>
    </div>`);
  box.querySelector('#device-theme').addEventListener('change', event => {
    setAppearance(event.target.checked ? 'system' : currentAppearance());
  });

  let start = inner.querySelector('.nav-start');
  if (!start) {
    start = document.createElement('a');
    start.className = 'nav-start';
    inner.appendChild(start);
  }
  start.href = s ? dashHref : 'register.html';
  start.innerHTML = `${s ? 'Dashboard' : 'Get started'} ${navIcon('arrow')}`;

  if (!inner.querySelector('.theme-toggle')) {
    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.type = 'button';
    themeToggle.setAttribute('role', 'switch');
    themeToggle.addEventListener('click', () => setAppearance(currentAppearance() === 'dark' ? 'light' : 'dark'));
    inner.appendChild(themeToggle);
  }

  let toggle = inner.querySelector('.nav-toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.className = 'nav-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', 'site-navigation');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    inner.appendChild(toggle);
    inner.appendChild(box);
    box.id = 'site-navigation';
    box.hidden = true;

    const close = () => {
      box.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    };
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      box.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    box.addEventListener('click', event => {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('click', event => {
      if (!inner.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !box.hidden) {
        close();
        toggle.focus();
      }
    });
  }

  if (!window.__navHashBound) {
    window.__navHashBound = true;
    window.addEventListener('hashchange', renderNavLinks);
  }
  syncAppearanceControls();
}

document.addEventListener('DOMContentLoaded', renderNavLinks, { once: true });


window.addEventListener('unhandledrejection', event => {
  event.preventDefault();
  toast(esc(event.reason?.message || 'LifeLink is temporarily unavailable.'), 'error');
});
