import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

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

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec(schema);

  const run = (sql, params = {}) => db.prepare(sql).run(params);
  const all = (sql, params = {}) => db.prepare(sql).all(params);
  const one = (sql, params = {}) => db.prepare(sql).get(params) ?? null;
  const lastInsertId = () => one('SELECT last_insert_rowid() AS id').id;

  function transaction(write) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  transaction(() => {
    for (const [recipient, groups] of Object.entries(COMPATIBILITY)) {
      groups.forEach((donor, priority) => {
        run('INSERT OR IGNORE INTO CompatibilityRule (recipient_group, donor_group, priority) VALUES (:recipient, :donor, :priority)',
            { recipient, donor, priority });
      });
    }
    for (const group of BLOOD_GROUPS) {
      run('INSERT OR IGNORE INTO BloodStock (blood_group) VALUES (:group)', { group });
    }
  });

  function saveDonorProfile(userId, p) {
    run('UPDATE Users SET phone = :ph WHERE user_id = :u', { ':ph': p.phone || null, ':u': userId });
    const existing = one('SELECT donor_id FROM Donor WHERE user_id = :u', { ':u': userId });
    if (existing) {
      run(`UPDATE Donor SET blood_group = :bg, organ = :og, age = :a, city = :c WHERE user_id = :u`,
          { ':bg': p.bloodGroup, ':og': p.organ, ':a': p.age, ':c': p.city, ':u': userId });
    } else {
      run(`INSERT INTO Donor (user_id, blood_group, organ, age, city, available)
           VALUES (:u, :bg, :og, :a, :c, 1)`,
          { ':u': userId, ':bg': p.bloodGroup, ':og': p.organ, ':a': p.age, ':c': p.city });
    }
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
    return { ok: true };
  }

  /** Admin tool: delete one request and its donor links. */
  function deleteRequest(requestId) {
    if (!getRequest(requestId)) return { ok: false, error: 'Request not found.' };
    run('DELETE FROM DonationMatch WHERE request_id = :r', { ':r': requestId });
    run('DELETE FROM Request WHERE request_id = :r', { ':r': requestId });
    return { ok: true };
  }

  /* ---- SUGGESTIONS (work before any profile exists) ---- */

  /** Open requests a person with this blood group / pledge could help — no login needed. */
  function suggestRequests(bloodGroup, organ, city) {
    return openRequestsForDonor({ blood_group: bloodGroup, organ: organ || 'blood', city: city || '' });
  }

  /* ---- donor ---- */

  function getDonorByUser(userId) {
    return one(`SELECT d.*, u.full_name, u.email, u.phone
                  FROM Donor d JOIN Users u ON u.user_id = d.user_id
                 WHERE d.user_id = :u`, { ':u': userId });
  }

  function setDonorAvailability(donorId, available) {
    run('UPDATE Donor SET available = :a WHERE donor_id = :d', { ':a': available ? 1 : 0, ':d': donorId });
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
      SELECT r.request_id, r.hospital_name, r.city,
             r.type, r.blood_group, r.organ, r.units, r.urgency, r.status, r.created_at, cr.priority,
             CASE WHEN a.match_id IS NOT NULL THEN r.requester_name END AS requester_name,
             CASE WHEN a.match_id IS NOT NULL THEN r.requester_phone END AS requester_phone,
             a.match_id AS accepted_match, m.match_id
        FROM Request r
        JOIN CompatibilityRule cr
          ON cr.recipient_group = r.blood_group
         AND cr.donor_group = :bg
        LEFT JOIN DonationMatch m ON m.request_id = r.request_id AND m.donor_id = :donor
        LEFT JOIN AcceptedMatch a USING (match_id)
       WHERE r.status IN ('pending','matched')
         AND ( r.type = 'blood' AND :organ = 'blood'
            OR r.type = 'organ' AND r.organ = :organ )
       ORDER BY CASE r.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
                cr.priority ASC,
                (r.city = :city) DESC,
                r.created_at ASC
       LIMIT 100`,
        { ':bg': donor.blood_group, ':organ': donor.organ, ':city': donor.city, ':donor': donor.donor_id ?? null });
  }

  /* ---- requests & public donor search (no login needed) ---- */

  function createRequest(f) {
    run(`INSERT INTO Request (requester_name, requester_phone, hospital_name, city, type, blood_group, organ, units, urgency)
         VALUES (:n, :ph, :h, :c, :t, :bg, :og, :u, :ur)`,
        { ':n': f.requesterName.trim(), ':ph': f.requesterPhone, ':h': f.hospitalName ? f.hospitalName.trim() : null,
          ':c': f.city.trim(), ':t': f.type, ':bg': f.bloodGroup,
          ':og': f.type === 'organ' ? f.organ : null, ':u': f.units, ':ur': f.urgency });
    const requestId = lastInsertId();
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
   * Contact details are kept out of the public result.
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
       ORDER BY match_rank ASC, same_city DESC, d.age ASC
       LIMIT 50`,
      { ':bg': q.bloodGroup, ':type': q.type, ':organ': q.organ || null, ':city': q.city || '' });
  }

  /**
   * A seeker contacts donors: creates the Request, links the chosen donors
   * (DonationMatch) and returns their phone numbers.
   * With no donors chosen the request stays 'pending' and appears on the
   * dashboards of compatible donors.
   */
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
    return { ok: true };
  }

  return { db, run, all, one, transaction,
    saveDonorProfile, deleteDonorAccount, deleteRequest, suggestRequests,
    getDonorByUser, setDonorAvailability, recordDonation, listDonationsForDonor,
    openRequestsForDonor, createRequest, listRequests,
    searchDonors, updateRequestStatus, getStock, criticalRequests,
    donorGroupSummary, dashboardStats, requestStatusCounts, listDonors,
    listUsers, listCompatibilityRules, listPendingDonations, reviewDonation,
  };
}
