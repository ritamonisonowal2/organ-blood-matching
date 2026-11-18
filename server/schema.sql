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

-- Session tokens and request tracking codes are stored only as hashes.
CREATE TABLE IF NOT EXISTS Session (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_user ON Session(user_id);
CREATE INDEX IF NOT EXISTS session_expiry ON Session(expires_at);

CREATE TABLE IF NOT EXISTS RequestAccess (
  request_id INTEGER PRIMARY KEY REFERENCES Request(request_id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS AcceptedMatch (
  match_id INTEGER PRIMARY KEY REFERENCES DonationMatch(match_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RateLimit (
  bucket TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_end INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (bucket, key_hash)
);

CREATE INDEX IF NOT EXISTS request_state ON Request(status, blood_group, type);
CREATE INDEX IF NOT EXISTS match_donor ON DonationMatch(donor_id);
CREATE INDEX IF NOT EXISTS donation_donor ON Donation(donor_id);
