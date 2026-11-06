-- ============================================================
-- LifeLink — Organ & Blood Matching System
-- schema.sql — complete DDL (mirrors js/db.js SCHEMA_SQL)
--
-- Entities : Users, Donor, Request, CompatibilityRule,
--            BloodStock, Donation, DonationMatch
-- Concepts : PRIMARY/FOREIGN/UNIQUE keys, NOT NULL, CHECK,
--            TRIGGERs, VIEWs
-- ============================================================

PRAGMA foreign_keys = ON;

-- 1 ── Login accounts (UNIQUE email, role CHECK) -----------------
CREATE TABLE Users (
  user_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name  TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  password   TEXT    NOT NULL,                 -- salted SHA-256 hex
  role       TEXT    NOT NULL CHECK (role IN ('donor','admin')),
  phone      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 2 ── Donor profile (1:1 with Users) ----------------------------
CREATE TABLE Donor (
  donor_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL UNIQUE REFERENCES Users(user_id),
  blood_group  TEXT    NOT NULL
               CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  organ        TEXT    NOT NULL
               CHECK (organ IN ('blood','kidney','liver','heart','lung','pancreas','cornea')),
  age          INTEGER NOT NULL CHECK (age BETWEEN 18 AND 65),
  city         TEXT    NOT NULL,
  available    INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  last_donation_date TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);

-- 3 ── Blood / organ requests — raised by ANYONE, no login ------
--      (seeker contact details live on the row)
CREATE TABLE Request (
  request_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_name  TEXT    NOT NULL,
  requester_phone TEXT    NOT NULL CHECK (length(requester_phone) = 10),
  hospital_name   TEXT,                        -- free text, optional
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

-- 5 ── Blood compatibility matrix (medical reference data) -------
CREATE TABLE CompatibilityRule (
  rule_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_group TEXT NOT NULL,
  donor_group     TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 1,   -- 0 = exact match
  UNIQUE (recipient_group, donor_group)
);

-- 6 ── Blood stock catalogue (CHECK prevents negative stock) -----
CREATE TABLE BloodStock (
  stock_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  blood_group         TEXT    NOT NULL UNIQUE,
  units               INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5
);

-- 7 ── Donations (INSERT fires trg_stock_on_donation) ------------
CREATE TABLE Donation (
  donation_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id      INTEGER NOT NULL REFERENCES Donor(donor_id),
  blood_group   TEXT    NOT NULL,
  units         INTEGER NOT NULL CHECK (units > 0),
  donation_date TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 8 ── M:N bridge: requests ↔ matched donors ----------------------
CREATE TABLE DonationMatch (
  match_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES Request(request_id),
  donor_id   INTEGER NOT NULL REFERENCES Donor(donor_id),
  matched_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (request_id, donor_id)
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Stock increases automatically when a donation is recorded
CREATE TABLE AuditLog (log_id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, record_id INTEGER,
  action TEXT NOT NULL, old_value TEXT, new_value TEXT, logged_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));

-- stock rises only when the admin APPROVES a donation (Donation.status: pending/approved/rejected)
CREATE TRIGGER trg_stock_on_donation AFTER UPDATE OF status ON Donation
WHEN NEW.status = 'approved' AND OLD.status <> 'approved'
BEGIN UPDATE BloodStock SET units = units + NEW.units WHERE blood_group = NEW.blood_group; END;

CREATE TRIGGER trg_audit_stock AFTER UPDATE OF units ON BloodStock
BEGIN INSERT INTO AuditLog (table_name, record_id, action, old_value, new_value)
  VALUES ('BloodStock', NEW.stock_id, 'stock ' || NEW.blood_group, OLD.units, NEW.units); END;

CREATE TRIGGER trg_audit_request AFTER UPDATE OF status ON Request
BEGIN INSERT INTO AuditLog (table_name, record_id, action, old_value, new_value)
  VALUES ('Request', NEW.request_id, 'status change', OLD.status, NEW.status); END;

-- Stock is deducted when a blood request is fulfilled
CREATE TRIGGER trg_stock_on_fulfilment
AFTER UPDATE OF status ON Request
WHEN NEW.status = 'fulfilled' AND NEW.type = 'blood' AND OLD.status <> 'fulfilled'
BEGIN
  UPDATE BloodStock
     SET units = units - NEW.units
   WHERE blood_group = NEW.blood_group
     AND units >= NEW.units;   -- never drop below 0 (CHECK would abort)
END;

-- ============================================================
-- VIEWS
-- ============================================================

-- Active critical requests (admin monitor)
CREATE VIEW vw_critical_requests AS
SELECT r.request_id, r.requester_name, r.requester_phone, r.hospital_name, r.city,
       r.type, r.blood_group, r.organ, r.units, r.urgency, r.status, r.created_at
  FROM Request r
 WHERE r.urgency = 'critical'
   AND r.status IN ('pending','matched');

-- Live stock status with low-stock flags
CREATE VIEW vw_stock_status AS
SELECT blood_group,
       units,
       low_stock_threshold,
       CASE WHEN units = 0                   THEN 'OUT'
            WHEN units < low_stock_threshold THEN 'LOW'
            ELSE 'OK' END AS stock_status
  FROM BloodStock;

-- Donors per blood group (dashboard summary)
CREATE VIEW vw_donor_group_summary AS
SELECT blood_group,
       COUNT(*)                                       AS total_donors,
       SUM(CASE WHEN available = 1 THEN 1 ELSE 0 END) AS available_donors
  FROM Donor
 GROUP BY blood_group;

-- ============================================================
-- KEY QUERY — auto matching (used by the 🎯 Find donors screen)
-- ============================================================
--
-- SELECT d.donor_id, u.full_name, d.blood_group, d.city,
--        CASE WHEN d.blood_group = :bg THEN 0 ELSE cr.priority END AS match_rank
--   FROM Donor d
--   JOIN Users u              ON u.user_id = d.user_id
--   JOIN CompatibilityRule cr ON cr.donor_group = d.blood_group
--                            AND cr.recipient_group = :bg
--  WHERE d.available = 1
--    AND (d.organ = :organ OR (:type = 'blood' AND d.organ = 'blood'))
--    AND NOT EXISTS (SELECT 1 FROM DonationMatch m
--                     JOIN Request r2 ON r2.request_id = m.request_id
--                    WHERE m.donor_id = d.donor_id
--                      AND r2.status IN ('pending','matched'))
--  ORDER BY match_rank ASC, (d.city = :city) DESC, d.age ASC;
