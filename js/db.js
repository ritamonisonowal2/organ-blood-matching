/* ============================================================
   LifeLink — Organ & Blood Matching System
   db.js — Database layer (SQLite running via sql.js)

   Demonstrates the DBMS concepts required by the project:
     • Users table with UNIQUE + NOT NULL constraints
     • Donor table with CHECK constraints (age, blood group, organ)
     • Request table (public seekers — no login) + DonationMatch FOREIGN KEYS
     • CompatibilityRule table + JOIN + ORDER BY  → auto matching
     • TRIGGER  → stock auto-updates when a donation is recorded
     • TRIGGER  → stock deducted when a blood request is fulfilled
     • VIEWs    → critical requests, stock status, donor summary
     • GROUP BY → dashboard summaries

   The database starts with SYSTEM reference data only (the medical
   compatibility table and an empty blood-stock catalogue). There are
   NO pre-created users, donors, requests or donations —
   even the administrator account is created by the first person to
   open the platform. Everything is created through the website UI.
   ============================================================ */

const DB_STORAGE_KEY   = 'lifelink_db_v1';
const SCHEMA_VERSION   = '6.0.0';   // bumped: demo/sample data removed — platform starts clean
const SCHEMA_STORE_KEY = 'lifelink_schema_version';
const SESSION_KEY_FOR_RESET = 'lifelink_session';   // same key auth.js uses

let SQL = null;   // sql.js module
let db  = null;   // active database handle

/* ---------- small helpers ---------- */

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Hash a password (SHA-256 + app salt). Plain text is never stored. */
async function hashPassword(password) {
  const salted = 'lifelink$' + password;
  if (window.crypto && window.crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  /* Fallback for very old browsers — demo only */
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < salted.length; i++) {
    const ch = salted.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

/* ---------- query helpers ---------- */

/** Execute DDL / DML that returns no rows. */
function run(sql, params) {
  db.run(sql, params || undefined);
}

/** Fetch all rows as objects. Named params use ':name' keys. */
function all(sql, params) {
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

/** Fetch the first row or null. */
function one(sql, params) {
  return all(sql, params)[0] || null;
}

function lastInsertId() {
  return one('SELECT last_insert_rowid() AS id').id;
}

/** Save the database image to localStorage so data survives refresh. */
function persist() {
  try {
    localStorage.setItem(DB_STORAGE_KEY, bytesToBase64(db.export()));
    /* sql.js export() closes & re-opens the connection, which silently
       turns FOREIGN KEY enforcement OFF — switch it back on. */
    db.run('PRAGMA foreign_keys = ON;');
  } catch (e) {
    console.error('Could not persist database', e);
  }
}

/* ============================================================
   SCHEMA — tables, constraints, triggers and views
   ============================================================ */

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

/* 1 ── Login accounts.  UNIQUE email + NOT NULL + role CHECK */
CREATE TABLE IF NOT EXISTS Users (
  user_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name  TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  password   TEXT    NOT NULL,
  role       TEXT    NOT NULL CHECK (role IN ('donor','admin')),
  phone      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

/* 2 ── Donor profile (1:1 with Users).  CHECK constraints on
      age, blood group, organ and the availability flag. */
CREATE TABLE IF NOT EXISTS Donor (
  donor_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL UNIQUE REFERENCES Users(user_id),
  blood_group  TEXT    NOT NULL
               CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  organ        TEXT    NOT NULL
               CHECK (organ IN ('blood','kidney','liver','heart','lung','pancreas','cornea')),
  age          INTEGER NOT NULL CHECK (age BETWEEN 18 AND 65),
  city         TEXT    NOT NULL,
  available    INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  last_donation_date TEXT
);

/* 3 ── Blood / organ requests.  Raised by ANYONE (no login) through the
      public search page — so the seeker's contact details live on the row.
      CHECK on phone / units / urgency / status, plus a compound CHECK that
      guarantees a blood request carries a blood group and an organ request
      carries an organ type. */
CREATE TABLE IF NOT EXISTS Request (
  request_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_name  TEXT    NOT NULL,
  requester_phone TEXT    NOT NULL CHECK (length(requester_phone) = 10),
  hospital_name   TEXT,
  city            TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK (type IN ('blood','organ')),
  blood_group TEXT    CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  organ       TEXT    CHECK (organ IN ('kidney','liver','heart','lung','pancreas','cornea')),
  units       INTEGER NOT NULL CHECK (units > 0),
  urgency     TEXT    NOT NULL CHECK (urgency IN ('normal','urgent','critical')),
  status      TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','matched','fulfilled','cancelled')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK ( (type = 'blood' AND blood_group IS NOT NULL AND organ IS NULL)
       OR (type = 'organ' AND organ IS NOT NULL AND blood_group IS NOT NULL) )
);

/* 5 ── Blood compatibility matrix (recipient group → donor groups).
      priority 0 = exact match, higher = compatible fallback.
      This is medical reference data — loaded once at setup. */
CREATE TABLE IF NOT EXISTS CompatibilityRule (
  rule_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_group TEXT NOT NULL,
  donor_group     TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (recipient_group, donor_group)
);

/* 6 ── Blood stock catalogue (one row per group, starts at 0).
      CHECK prevents negative stock. */
CREATE TABLE IF NOT EXISTS BloodStock (
  stock_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  blood_group         TEXT    NOT NULL UNIQUE,
  units               INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5
);

/* 7 ── Donations actually given.  INSERT here fires the stock TRIGGER. */
CREATE TABLE IF NOT EXISTS Donation (
  donation_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id      INTEGER NOT NULL REFERENCES Donor(donor_id),
  blood_group   TEXT    NOT NULL,
  units         INTEGER NOT NULL CHECK (units > 0),
  donation_date TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  status        TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);

/* 8 ── M:N link between requests and the donors matched to them
      (populated from the auto-matching results screen). */
CREATE TABLE IF NOT EXISTS DonationMatch (
  match_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES Request(request_id),
  donor_id   INTEGER NOT NULL REFERENCES Donor(donor_id),
  matched_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (request_id, donor_id)
);

/* ── TRIGGER: stock auto-updates when a donation is recorded ── */
CREATE TABLE IF NOT EXISTS AuditLog (
  log_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id  INTEGER,
  action     TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  logged_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* stock goes up only when the ADMIN approves a donation */
CREATE TRIGGER IF NOT EXISTS trg_stock_on_donation
AFTER UPDATE OF status ON Donation
WHEN NEW.status = 'approved' AND OLD.status <> 'approved'
BEGIN
  UPDATE BloodStock SET units = units + NEW.units WHERE blood_group = NEW.blood_group;
END;

/* audit triggers: every stock change and request status change is logged */
CREATE TRIGGER IF NOT EXISTS trg_audit_stock
AFTER UPDATE OF units ON BloodStock
BEGIN
  INSERT INTO AuditLog (table_name, record_id, action, old_value, new_value)
  VALUES ('BloodStock', NEW.stock_id, 'stock ' || NEW.blood_group, OLD.units, NEW.units);
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_request
AFTER UPDATE OF status ON Request
BEGIN
  INSERT INTO AuditLog (table_name, record_id, action, old_value, new_value)
  VALUES ('Request', NEW.request_id, 'status change', OLD.status, NEW.status);
END;

/* ── TRIGGER: stock is deducted when a blood request is fulfilled ── */
CREATE TRIGGER IF NOT EXISTS trg_stock_on_fulfilment
AFTER UPDATE OF status ON Request
WHEN NEW.status = 'fulfilled' AND NEW.type = 'blood' AND OLD.status <> 'fulfilled'
BEGIN
  UPDATE BloodStock
     SET units = units - NEW.units
   WHERE blood_group = NEW.blood_group
     AND units >= NEW.units;   -- never drop below 0 (CHECK would abort)
END;

/* ── VIEW: active critical requests (admin monitor) ── */
CREATE VIEW IF NOT EXISTS vw_critical_requests AS
SELECT r.request_id, r.requester_name, r.requester_phone, r.hospital_name, r.city,
       r.type, r.blood_group, r.organ, r.units, r.urgency, r.status, r.created_at
  FROM Request r
 WHERE r.urgency = 'critical'
   AND r.status IN ('pending','matched');

/* ── VIEW: live stock status with low-stock flags ── */
CREATE VIEW IF NOT EXISTS vw_stock_status AS
SELECT blood_group,
       units,
       low_stock_threshold,
       CASE WHEN units = 0                   THEN 'OUT'
            WHEN units < low_stock_threshold THEN 'LOW'
            ELSE 'OK' END AS stock_status
  FROM BloodStock;

/* ── VIEW: donors per blood group (dashboard summary) ── */
CREATE VIEW IF NOT EXISTS vw_donor_group_summary AS
SELECT blood_group,
       COUNT(*)                                       AS total_donors,
       SUM(CASE WHEN available = 1 THEN 1 ELSE 0 END) AS available_donors
  FROM Donor
 GROUP BY blood_group;
`;

/* ============================================================
   SYSTEM SETUP — reference data only (no demo content).
     • Blood compatibility matrix (medical facts)
     • Blood stock catalogue (all groups start at 0 units)
   No user accounts are created here. The first administrator
   registers through the "First-time setup" screen.
   ============================================================ */

/* blood groups — also referenced by admin.js for chart labels */
const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

/* recipient group → compatible donor groups, best first */
const COMPATIBILITY = {
  'O-' : ['O-'],
  'O+' : ['O+','O-'],
  'A-' : ['A-','O-'],
  'A+' : ['A+','O+','A-','O-'],
  'B-' : ['B-','O-'],
  'B+' : ['B+','O+','B-','O-'],
  'AB-': ['AB-','A-','B-','O-'],
  'AB+': ['AB+','A+','B+','AB-','O+','O-','A-','B-']
};

function sqlStr(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }

async function seedSystemData() {
  /* compatibility matrix */
  for (const recipient of Object.keys(COMPATIBILITY)) {
    COMPATIBILITY[recipient].forEach((donorGroup, idx) => {
      run(`INSERT INTO CompatibilityRule (recipient_group, donor_group, priority)
           VALUES (${sqlStr(recipient)}, ${sqlStr(donorGroup)}, ${idx})`);
    });
  }

  /* empty stock catalogue */
  for (const g of BLOOD_GROUPS) {
    run(`INSERT INTO BloodStock (blood_group, units, low_stock_threshold)
         VALUES (${sqlStr(g)}, 0, 5)`);
  }

  persist();
}

/* ============================================================
   INITIALISATION
   ============================================================ */

async function initDatabase() {
  if (db) return;

  if (!SQL) {
    SQL = await initSqlJs();   // sql.js (asm.js build) from vendor/
  }

  const saved  = localStorage.getItem(DB_STORAGE_KEY);
  const savedV = localStorage.getItem(SCHEMA_STORE_KEY);

  if (saved && savedV === SCHEMA_VERSION) {
    try {
      db = new SQL.Database(base64ToBytes(saved));
      db.exec('SELECT 1 FROM Users LIMIT 1');   // sanity check the image
      run('PRAGMA foreign_keys = ON;');
      return;
    } catch (e) {
      console.warn('Saved database was unreadable — starting fresh.', e);
      db = null;
    }
  }

  /* fresh platform (first run, new schema version, or unreadable image) */
  localStorage.removeItem(DB_STORAGE_KEY);
  localStorage.removeItem(SESSION_KEY_FOR_RESET);
  sessionStorage.removeItem(SESSION_KEY_FOR_RESET);
  db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  await seedSystemData();
  localStorage.setItem(SCHEMA_STORE_KEY, SCHEMA_VERSION);
}

/** Wipe everything and return to a clean platform (reference data only). */
async function resetDatabase() {
  localStorage.removeItem(DB_STORAGE_KEY);
  localStorage.removeItem(SCHEMA_STORE_KEY);
  localStorage.removeItem(SESSION_KEY_FOR_RESET);
  sessionStorage.removeItem(SESSION_KEY_FOR_RESET);
  db = null;
  await initDatabase();
}

/** Download the live database as a real .sqlite file
    (opens in "DB Browser for SQLite" — useful for report screenshots). */
function downloadDatabaseFile() {
  const bytes = db.export();
  const blob  = new Blob([bytes], { type: 'application/octet-stream' });
  const a     = document.createElement('a');
  a.href      = URL.createObjectURL(blob);
  a.download  = 'lifelink.sqlite';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   DOMAIN FUNCTIONS — called by the UI pages
   ============================================================ */

/* ---- registration & login ---- */

/** True once the first administrator has been created. */
function adminExists() {
  return !!one("SELECT user_id FROM Users WHERE role = 'admin' LIMIT 1");
}

/** Does this saved session still point at a real account? */
function sessionUserExists(s) {
  return !!(s && one('SELECT user_id FROM Users WHERE user_id = :u AND role = :r',
                     { ':u': s.user_id, ':r': s.role }));
}

/**
 * SIMPLE SIGN-UP — only name + email + password + role.
 * The donor profile (blood group, city, age …) is filled in AFTER
 * sign-up, inside the dashboard (saveDonorProfile), like a normal website.
 * There are no hospital accounts: anyone can search and request without logging in.
 */
async function registerUser(form) {
  const email = form.email.trim().toLowerCase();

  if (form.role === 'admin' && adminExists()) {
    return { ok: false, error: 'An administrator already exists. Please log in instead.' };
  }

  if (one('SELECT user_id FROM Users WHERE lower(email) = :e', { ':e': email })) {
    return { ok: false, error: 'This email is already registered. Try logging in.' };
  }

  const pw = await hashPassword(form.password);
  run(`INSERT INTO Users (full_name, email, password, role, phone)
       VALUES (:n, :e, :p, :r, :ph)`,
      { ':n': form.fullName.trim(), ':e': email, ':p': pw, ':r': form.role, ':ph': form.phone || null });
  const userId = lastInsertId();

  persist();
  return { ok: true, userId };
}

/** Create / update the donor profile (called from the donor dashboard). */
function saveDonorProfile(userId, p) {
  if (p.phone) run('UPDATE Users SET phone = :ph WHERE user_id = :u', { ':ph': p.phone, ':u': userId });
  const existing = one('SELECT donor_id FROM Donor WHERE user_id = :u', { ':u': userId });
  if (existing) {
    run(`UPDATE Donor SET blood_group = :bg, organ = :og, age = :a, city = :c WHERE user_id = :u`,
        { ':bg': p.bloodGroup, ':og': p.organ, ':a': p.age, ':c': p.city, ':u': userId });
  } else {
    run(`INSERT INTO Donor (user_id, blood_group, organ, age, city, available)
         VALUES (:u, :bg, :og, :a, :c, 1)`,
        { ':u': userId, ':bg': p.bloodGroup, ':og': p.organ, ':a': p.age, ':c': p.city });
  }
  persist();
  return { ok: true };
}

/** Permanently delete a donor's account and everything linked to it
    (children first, so FOREIGN KEYS are respected). Donations already
    counted in blood stock stay in stock — only the donor's records go. */
function deleteDonorAccount(userId) {
  const u = one('SELECT role FROM Users WHERE user_id = :u', { ':u': userId });
  if (!u) return { ok: false, error: 'Account not found.' };
  if (u.role !== 'donor') return { ok: false, error: 'Only donor accounts can be deleted here.' };
  const d = one('SELECT donor_id FROM Donor WHERE user_id = :u', { ':u': userId });
  if (d) {
    run('DELETE FROM DonationMatch WHERE donor_id = :d', { ':d': d.donor_id });
    run('DELETE FROM Donation      WHERE donor_id = :d', { ':d': d.donor_id });
    run('DELETE FROM Donor         WHERE donor_id = :d', { ':d': d.donor_id });
  }
  run('DELETE FROM Users WHERE user_id = :u', { ':u': userId });
  persist();
  return { ok: true };
}

/** Admin tool: delete one request and its donor links. */
function deleteRequest(requestId) {
  if (!getRequest(requestId)) return { ok: false, error: 'Request not found.' };
  run('DELETE FROM DonationMatch WHERE request_id = :r', { ':r': requestId });
  run('DELETE FROM Request WHERE request_id = :r', { ':r': requestId });
  persist();
  return { ok: true };
}

/* ---- SUGGESTIONS (work before any profile exists) ---- */

/** Open requests a person with this blood group / pledge could help — no login needed. */
function suggestRequests(bloodGroup, organ, city) {
  return openRequestsForDonor({ blood_group: bloodGroup, organ: organ || 'blood', city: city || '' });
}

async function loginUser(email, password) {
  const row = one('SELECT * FROM Users WHERE lower(email) = :e', { ':e': email.trim().toLowerCase() });
  if (!row) return { ok: false, error: 'No account found with this email.' };
  const pw = await hashPassword(password);
  if (pw !== row.password) return { ok: false, error: 'Incorrect password.' };
  return { ok: true, user: row };
}

/* ---- donor ---- */

function getDonorByUser(userId) {
  return one(`SELECT d.*, u.full_name, u.email, u.phone
                FROM Donor d JOIN Users u ON u.user_id = d.user_id
               WHERE d.user_id = :u`, { ':u': userId });
}

function setDonorAvailability(donorId, available) {
  run('UPDATE Donor SET available = :a WHERE donor_id = :d', { ':a': available ? 1 : 0, ':d': donorId });
  persist();
}

/** Record a donation → fires trg_stock_on_donation. */
function recordDonation(donorId, units) {
  const donor = one('SELECT * FROM Donor WHERE donor_id = :d', { ':d': donorId });
  if (!donor) return { ok: false, error: 'Donor not found.' };
  if (donor.organ !== 'blood') {
    return { ok: false, error: 'Only whole-blood donors can record a blood donation (your pledge is: ' + donor.organ + ').' };
  }

  run('INSERT INTO Donation (donor_id, blood_group, units) VALUES (:d, :bg, :u)',
      { ':d': donorId, ':bg': donor.blood_group, ':u': units });
  persist();

  return { ok: true, bloodGroup: donor.blood_group, pending: true };
}

function listDonationsForDonor(donorId) {
  return all(`SELECT donation_id, blood_group, units, donation_date, status
                FROM Donation WHERE donor_id = :d ORDER BY donation_date DESC`, { ':d': donorId });
}

/** Open requests this donor can help with — the CompatibilityRule JOIN doubles
    as the filter and also tells us match quality (priority 0 = exact group). */
function openRequestsForDonor(donor) {
  return all(`
    SELECT r.request_id, r.requester_name, r.requester_phone, r.hospital_name, r.city,
           r.type, r.blood_group, r.organ, r.units, r.urgency, r.status, r.created_at, cr.priority
      FROM Request r
      JOIN CompatibilityRule cr
        ON cr.recipient_group = r.blood_group
       AND cr.donor_group = :bg
     WHERE r.status IN ('pending','matched')
       AND ( r.type = 'blood' AND :organ = 'blood'
          OR r.type = 'organ' AND r.organ = :organ )
     ORDER BY CASE r.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
              cr.priority ASC,
              (r.city = :city) DESC,
              r.created_at ASC`,
      { ':bg': donor.blood_group, ':organ': donor.organ, ':city': donor.city });
}

/** Which recipient groups can this blood group help? */
function recipientGroupsFor(bloodGroup) {
  return all('SELECT recipient_group FROM CompatibilityRule WHERE donor_group = :g ORDER BY priority',
             { ':g': bloodGroup }).map(r => r.recipient_group);
}

/* ---- requests & public donor search (no login needed) ---- */

function createRequest(f) {
  run(`INSERT INTO Request (requester_name, requester_phone, hospital_name, city, type, blood_group, organ, units, urgency)
       VALUES (:n, :ph, :h, :c, :t, :bg, :og, :u, :ur)`,
      { ':n': f.requesterName.trim(), ':ph': f.requesterPhone, ':h': f.hospitalName ? f.hospitalName.trim() : null,
        ':c': f.city.trim(), ':t': f.type, ':bg': f.bloodGroup,
        ':og': f.type === 'organ' ? f.organ : null, ':u': f.units, ':ur': f.urgency });
  const requestId = lastInsertId();   // read before persist() — export() resets rowid state
  persist();
  return { ok: true, requestId };
}

function listRequests() {
  return all(`
    SELECT r.*,
           (SELECT COUNT(*) FROM DonationMatch m WHERE m.request_id = r.request_id) AS match_count
      FROM Request r
     ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'matched' THEN 1 ELSE 2 END,
              CASE r.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
              r.created_at DESC`);
}

function getRequest(requestId) {
  return one('SELECT * FROM Request WHERE request_id = :r', { ':r': requestId });
}

/**
 * PUBLIC DONOR SEARCH — the heart of the system. No login required.
 *
 * SQL concepts shown here:
 *   • JOIN CompatibilityRule : every donor whose blood group can give to the
 *     needed group is pulled in through the compatibility matrix.
 *   • ORDER BY : exact blood group first, then compatible groups,
 *     then donors in the same city, then younger donors.
 *   • NOT EXISTS : a donor already booked on another active request is skipped.
 *
 * Only a first name + last initial is returned; the phone number is
 * revealed only after the seeker leaves their own contact details.
 */
function searchDonors(q) {
  return all(`
    SELECT d.donor_id,
           CASE WHEN instr(trim(u.full_name), ' ') > 0
                THEN substr(trim(u.full_name), 1, instr(trim(u.full_name), ' ') + 1) || '.'
                ELSE trim(u.full_name) END AS display_name,
           d.blood_group, d.organ, d.age, d.city,
           CASE WHEN d.blood_group = :bg THEN 0 ELSE cr.priority END AS match_rank,
           CASE WHEN d.blood_group = :bg THEN 'Exact blood group'
                ELSE 'Compatible (' || d.blood_group || ')' END AS match_type,
           (d.city = :city) AS same_city
      FROM Donor d
      JOIN Users u ON u.user_id = d.user_id
      JOIN CompatibilityRule cr
        ON cr.donor_group = d.blood_group AND cr.recipient_group = :bg
     WHERE d.available = 1
       AND ( (:type = 'organ' AND d.organ = :organ) OR (:type = 'blood' AND d.organ = 'blood') )
       AND NOT EXISTS (
             SELECT 1 FROM DonationMatch m
               JOIN Request r2 ON r2.request_id = m.request_id
              WHERE m.donor_id = d.donor_id AND r2.status IN ('pending','matched'))
     ORDER BY match_rank ASC, same_city DESC, d.age ASC`,
    { ':bg': q.bloodGroup, ':type': q.type, ':organ': q.organ || null, ':city': q.city || '' });
}

/**
 * A seeker contacts donors: creates the Request, links the chosen donors
 * (DonationMatch) and returns their phone numbers.
 * With no donors chosen the request stays 'pending' and appears on the
 * dashboards of compatible donors.
 */
function contactDonors(form, donorIds) {
  const { requestId } = createRequest(form);
  for (const dId of donorIds || []) {
    run('INSERT OR IGNORE INTO DonationMatch (request_id, donor_id) VALUES (:r, :d)', { ':r': requestId, ':d': dId });
  }
  if (donorIds && donorIds.length) {
    run("UPDATE Request SET status = 'matched' WHERE request_id = :r", { ':r': requestId });
  }
  persist();
  return { ok: true, requestId, donors: listMatches(requestId) };
}

function listMatches(requestId) {
  return all(`SELECT m.match_id, u.full_name, d.blood_group, d.city, u.phone, m.matched_at
                FROM DonationMatch m
                JOIN Donor d ON d.donor_id = m.donor_id
                JOIN Users u ON u.user_id = d.user_id
               WHERE m.request_id = :r ORDER BY m.matched_at`, { ':r': requestId });
}

/** Change request status. 'fulfilled' on a blood request fires the stock TRIGGER.
    fulfilled / cancelled are terminal — reopening is blocked so the fulfilment
    trigger can never deduct stock twice for the same request. */
function updateRequestStatus(requestId, newStatus) {
  const req = getRequest(requestId);
  if (!req) return { ok: false, error: 'Request not found.' };
  if (req.status === newStatus) return { ok: true };

  if (req.status === 'fulfilled' || req.status === 'cancelled') {
    return { ok: false, error: `Request #${requestId} is ${req.status} — closed requests cannot change status.` };
  }

  if (newStatus === 'fulfilled' && req.type === 'blood') {
    const stock = one('SELECT units FROM BloodStock WHERE blood_group = :bg', { ':bg': req.blood_group });
    if (!stock || stock.units < req.units) {
      return { ok: false,
               error: `Not enough ${req.blood_group} stock (have ${stock ? stock.units : 0}, need ${req.units}). Fulfil blocked by the CHECK constraint.` };
    }
  }

  run('UPDATE Request SET status = :s WHERE request_id = :r', { ':s': newStatus, ':r': requestId });
  persist();

  let note = '';
  if (newStatus === 'fulfilled' && req.type === 'blood') {
    const after = one('SELECT units FROM BloodStock WHERE blood_group = :bg', { ':bg': req.blood_group });
    note = `Blood stock updated automatically — ${req.units} unit(s) of ${req.blood_group} deducted, ${after.units} left.`;
  }
  return { ok: true, note };
}

/* ---- stock & dashboard (GROUP BY / VIEWs) ---- */

function getStock()          { return all('SELECT * FROM vw_stock_status ORDER BY blood_group'); }
function criticalRequests()  { return all('SELECT * FROM vw_critical_requests ORDER BY created_at'); }
function donorGroupSummary() { return all('SELECT * FROM vw_donor_group_summary ORDER BY blood_group'); }

function dashboardStats() {
  return {
    totalDonors:       one('SELECT COUNT(*) AS c FROM Donor').c,
    availableDonors:   one('SELECT COUNT(*) AS c FROM Donor WHERE available = 1').c,
    totalRequests:     one('SELECT COUNT(*) AS c FROM Request').c,
    openRequests:      one("SELECT COUNT(*) AS c FROM Request WHERE status IN ('pending','matched')").c,
    totalUnits:        one('SELECT COALESCE(SUM(units),0) AS c FROM BloodStock').c,
    pendingRequests:   one("SELECT COUNT(*) AS c FROM Request WHERE status = 'pending'").c,
    criticalRequests:  one("SELECT COUNT(*) AS c FROM Request WHERE urgency='critical' AND status IN ('pending','matched')").c,
    fulfilledRequests: one("SELECT COUNT(*) AS c FROM Request WHERE status = 'fulfilled'").c,
    totalDonations:    one("SELECT COUNT(*) AS c FROM Donation WHERE status = 'approved'").c,
    pendingDonations:  one("SELECT COUNT(*) AS c FROM Donation WHERE status = 'pending'").c
  };
}

/** Requests grouped by status — GROUP BY feeds the doughnut chart. */
function requestStatusCounts() {
  return all('SELECT status, COUNT(*) AS cnt FROM Request GROUP BY status');
}

function listDonors() {
  return all(`SELECT d.donor_id, d.user_id, u.full_name, u.email, u.phone, d.blood_group,
                     d.organ, d.age, d.city, d.available, d.last_donation_date
                FROM Donor d JOIN Users u ON u.user_id = d.user_id
               ORDER BY d.blood_group, u.full_name`);
}

/** Admin tool: set a new password for any non-admin account. */
async function adminResetPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
  const u = one('SELECT role FROM Users WHERE user_id = :u', { ':u': userId });
  if (!u) return { ok: false, error: 'User not found.' };
  if (u.role === 'admin') return { ok: false, error: 'Administrator passwords cannot be reset from here.' };
  run('UPDATE Users SET password = :p WHERE user_id = :u', { ':p': await hashPassword(newPassword), ':u': userId });
  persist();
  return { ok: true };
}

function listUsers() {
  return all('SELECT user_id, full_name, email, role, phone, created_at FROM Users ORDER BY user_id');
}

function listCompatibilityRules() {
  return all(`SELECT recipient_group, donor_group, priority
                FROM CompatibilityRule
               ORDER BY recipient_group, priority`);
}

/* ---- v6: donation approval, request tracking, audit log ---- */
function listPendingDonations() {
  return all(`SELECT n.donation_id, u.full_name, n.blood_group, n.units, n.donation_date
                FROM Donation n JOIN Donor d ON d.donor_id = n.donor_id JOIN Users u ON u.user_id = d.user_id
               WHERE n.status = 'pending' ORDER BY n.donation_date`);
}
/** Admin approves/rejects. Approval fires trg_stock_on_donation. */
function reviewDonation(id, decision) {
  const d = one('SELECT * FROM Donation WHERE donation_id = :i', { ':i': id });
  if (!d) return { ok: false, error: 'Donation not found.' };
  if (d.status !== 'pending') return { ok: false, error: 'This donation was already reviewed.' };
  run('UPDATE Donation SET status = :s WHERE donation_id = :i', { ':s': decision, ':i': id });
  if (decision === 'approved')
    run("UPDATE Donor SET last_donation_date = datetime('now','localtime') WHERE donor_id = :d", { ':d': d.donor_id });
  persist();
  return { ok: true };
}
/** Seeker tracks a request with request number + the phone used to post it. */
function trackRequest(id, phone) {
  const r = one('SELECT * FROM Request WHERE request_id = :r AND requester_phone = :p', { ':r': id, ':p': String(phone).trim() });
  return r ? { ok: true, request: r, donors: listMatches(id) }
           : { ok: false, error: 'No request found with that number and phone.' };
}
function cancelMyRequest(id, phone) {
  const t = trackRequest(id, phone);
  return t.ok ? updateRequestStatus(id, 'cancelled') : t;
}
function listAuditLog() { return all('SELECT * FROM AuditLog ORDER BY log_id DESC LIMIT 15'); }
