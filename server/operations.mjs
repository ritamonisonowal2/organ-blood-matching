import { digest, hashPassword, HttpError, limit, passwordMatches, token, validEmail, validPassword } from './security.mjs';

const groups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const organs = ['kidney', 'liver', 'heart', 'lung', 'pancreas', 'cornea'];
const statuses = ['pending', 'matched', 'fulfilled', 'cancelled'];

function invalid(message = 'Check the submitted fields and try again.') {
  throw new HttpError(422, message);
}

function text(value, max, min = 0) {
  if (typeof value !== 'string' || value.length > max) invalid();
  const trimmed = value.trim();
  if (trimmed.length < min) invalid();
  return trimmed;
}

function choice(value, choices) {
  if (!choices.includes(value)) invalid();
  return value;
}

function integer(value, min = 1, max = 2147483647) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}

function phone(value, optional = false) {
  const number = text(value, 10);
  if (!(optional && number === '') && !/^\d{10}$/.test(number)) invalid('Enter a 10-digit phone number.');
  return number;
}

function searchFields(body) {
  const type = choice(body.type, ['blood', 'organ']);
  return {
    type, bloodGroup: choice(body.bloodGroup, groups),
    organ: type === 'organ' ? choice(body.organ, organs) : null,
    city: text(body.city ?? '', 100)
  };
}

function publicRequest(row) {
  const { hospital_name, city, type, blood_group, organ, units, urgency, status, priority } = row;
  return { hospital_name, city, type, blood_group, organ, units, urgency, status, priority };
}

export function createOperations(store, { reservedEmail } = {}) {
  function requireDonor(user) {
    const donor = store.getDonorByUser(user.user_id);
    if (!donor) throw new HttpError(403, 'Complete your donor profile first.');
    return donor;
  }

  async function register({ body, ip }) {
    if (body.role !== undefined && body.role !== 'donor') {
      throw new HttpError(403, 'Public registration is available for donors.');
    }
    const email = text(body.email, 254, 3).toLowerCase();
    const name = text(body.fullName, 100, 2);
    if (!validEmail(email)) invalid('Enter a valid email address.');
    if (email === reservedEmail) throw new HttpError(409, 'An account already exists for that email.');
    if (!validPassword(body.password)) invalid('Use a password with 12 to 128 characters.');
    limit(store, 'register', ip, 8, 3600);
    const password = await hashPassword(body.password);
    const result = store.run(`
      INSERT INTO Users (full_name, email, password, role) VALUES (:name, :email, :password, 'donor')
      ON CONFLICT (email) DO NOTHING`, { name, email, password });
    if (!result.changes) throw new HttpError(409, 'An account already exists for that email.');
    return { ok: true };
  }

  async function login({ body, ip, startSession }) {
    const email = text(body.email, 254, 3).toLowerCase();
    const password = body.password;
    if (!validEmail(email) || typeof password !== 'string' || !password || password.length > 128) invalid();
    limit(store, 'login-ip', ip, 30, 900);
    limit(store, 'login-email', email, 10, 900);
    const account = store.one('SELECT user_id, full_name, role, password FROM Users WHERE email = :email', { email });
    if (!(await passwordMatches(password, account?.password))) {
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    const { user_id, full_name, role } = account;
    // A password reset or deletion during verification must invalidate this attempt.
    store.transaction(() => {
      const current = store.one('SELECT password FROM Users WHERE user_id = :user_id', { user_id });
      if (current?.password !== account.password) throw new HttpError(401, 'Email or password is incorrect.');
      startSession(user_id, body.remember === true);
    });
    return { ok: true, user: { user_id, full_name, role } };
  }

  function postRequest({ body, ip }) {
    limit(store, 'post-request', ip, 12, 3600);
    const query = searchFields(body);
    const form = {
      ...query, city: text(query.city, 100, 1),
      requesterName: text(body.requesterName, 100, 2), requesterPhone: phone(body.requesterPhone),
      hospitalName: text(body.hospitalName ?? '', 160), units: integer(body.units, 1, 100),
      urgency: choice(body.urgency, ['normal', 'urgent', 'critical'])
    };
    if (!Array.isArray(body.donorIds) || body.donorIds.length > 10) invalid('Choose up to 10 donors.');
    const donorIds = [...new Set(body.donorIds.map(id => integer(id)))];
    return store.transaction(() => {
      const available = donorIds.length ? new Set(store.searchDonors(query).map(donor => donor.donor_id)) : new Set();
      if (donorIds.some(id => !available.has(id))) {
        throw new HttpError(409, 'A selected donor is no longer available. Refresh your search and try again.');
      }
      const { requestId } = store.createRequest(form);
      const trackingCode = token();
      store.run('INSERT INTO RequestAccess VALUES (:requestId, :code)', { requestId, code: digest(trackingCode) });
      for (const donorId of donorIds) {
        store.run('INSERT INTO DonationMatch (request_id, donor_id) VALUES (:requestId, :donorId)', { requestId, donorId });
      }
      if (donorIds.length) store.updateRequestStatus(requestId, 'matched');
      return { ok: true, requestId, trackingCode };
    });
  }

  function ownRequest(body, ip) {
    limit(store, 'track-request', ip, 45, 900);
    const id = integer(body.id);
    const code = text(body.code, 43, 43);
    const request = store.one(`
      SELECT r.request_id, r.blood_group, r.type, r.units, r.status
        FROM Request r JOIN RequestAccess a USING (request_id)
       WHERE r.request_id = :id AND a.code_hash = :code`, { id, code: digest(code) });
    if (!request) throw new HttpError(404, 'No request found with that number and tracking code.');
    return request;
  }

  function donorRequests(donor) {
    return store.openRequestsForDonor(donor).map(({
      match_id, accepted_match, requester_name, requester_phone, ...row
    }) => ({
      ...row, canAccept: Boolean(donor.available && (match_id || row.status === 'pending')),
      accepted: Boolean(accepted_match),
      requester_name: requester_name ?? undefined,
      requester_phone: requester_phone ?? undefined
    }));
  }

  function acceptRequest({ body, user }) {
    return store.transaction(() => {
      const donor = requireDonor(user);
      if (!donor.phone) invalid('Add your phone number to your donor profile before accepting.');
      const id = integer(body.id);
      const request = donorRequests(donor).find(row => row.request_id === id && row.canAccept);
      if (!request) throw new HttpError(409, 'This request is no longer available to your profile.');
      store.run('INSERT OR IGNORE INTO DonationMatch (request_id, donor_id) VALUES (:id, :donorId)',
        { id, donorId: donor.donor_id });
      store.run(`INSERT OR IGNORE INTO AcceptedMatch (match_id)
        SELECT match_id FROM DonationMatch WHERE request_id = :id AND donor_id = :donorId`, { id, donorId: donor.donor_id });
      if (request.status === 'pending') store.updateRequestStatus(id, 'matched');
      return { ok: true };
    });
  }

  async function resetPassword({ body, authorize }) {
    const id = integer(body.id);
    if (!validPassword(body.password)) invalid('Use a password with 12 to 128 characters.');
    const password = await hashPassword(body.password);
    return store.transaction(() => {
      authorize();
      const result = store.run("UPDATE Users SET password = :password WHERE user_id = :id AND role = 'donor'", { id, password });
      if (!result.changes) throw new HttpError(404, 'Donor account not found.');
      store.run('DELETE FROM Session WHERE user_id = :id', { id });
      return { ok: true };
    });
  }

  return new Map(Object.entries({
    session: ['public', ({ user }) => user],
    register: ['public', register],
    login: ['public', login],
    logout: ['public', ({ endSession }) => { endSession(); return { ok: true }; }],
    publicOverview: ['public', () => ({
      stats: store.dashboardStats(), stock: store.getStock(), requestCounts: store.requestStatusCounts(),
      rules: store.listCompatibilityRules(), donorGroups: store.donorGroupSummary(),
      organCounts: store.all("SELECT organ, COUNT(*) AS c FROM Donor WHERE available = 1 AND organ <> 'blood' GROUP BY organ")
    })],
    search: ['public', ({ body }) => store.searchDonors(searchFields(body))],
    openRequests: ['public', () => store.all(`
      SELECT hospital_name, city, type, blood_group, organ, units, urgency, status FROM Request
       WHERE status IN ('pending','matched')
       ORDER BY CASE urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, created_at DESC LIMIT 6`)],
    suggestions: ['public', ({ body }) => store.suggestRequests(
      choice(body.group, groups), choice(body.organ, ['blood', ...organs]), text(body.city ?? '', 100)
    ).slice(0, 10).map(publicRequest)],
    postRequest: ['public', postRequest],
    trackRequest: ['public', ({ body, ip }) => {
      const request = ownRequest(body, ip);
      const donors = store.all(`
        SELECT u.full_name, u.phone FROM AcceptedMatch a JOIN DonationMatch m USING (match_id)
          JOIN Donor d USING (donor_id) JOIN Users u USING (user_id)
         WHERE m.request_id = :id ORDER BY m.match_id`, { id: request.request_id });
      return { ok: true, request, donors };
    }],
    cancelRequest: ['public', ({ body, ip }) => {
      const request = ownRequest(body, ip);
      return store.transaction(() => store.updateRequestStatus(request.request_id, 'cancelled'));
    }],

    donorProfile: ['donor', ({ user }) => store.getDonorByUser(user.user_id)],
    saveProfile: ['donor', ({ body, user }) => store.transaction(() => store.saveDonorProfile(user.user_id, {
      bloodGroup: choice(body.bloodGroup, groups), organ: choice(body.organ, ['blood', ...organs]),
      age: integer(body.age, 18, 65), city: text(body.city, 100, 1), phone: phone(body.phone, true)
    }))],
    deleteProfile: ['donor', ({ user, endSession }) => store.transaction(() => {
      const result = store.deleteDonorAccount(user.user_id);
      if (result.ok) endSession();
      return result;
    })],
    donorRequests: ['donor', ({ user }) => donorRequests(requireDonor(user))],
    acceptRequest: ['donor', acceptRequest],
    donationHistory: ['donor', ({ user }) => store.listDonationsForDonor(requireDonor(user).donor_id)],
    availability: ['donor', ({ body, user }) => {
      if (typeof body.available !== 'boolean') invalid();
      return store.transaction(() => {
        store.setDonorAvailability(requireDonor(user).donor_id, body.available);
        return { ok: true };
      });
    }],
    recordDonation: ['donor', ({ body, user }) => store.transaction(() =>
      store.recordDonation(requireDonor(user).donor_id, integer(body.units, 1, 10)))],

    adminOverview: ['admin', () => ({
      stats: store.dashboardStats(), stock: store.getStock(), critical: store.criticalRequests(),
      requests: store.listRequests(), donors: store.listDonors(), users: store.listUsers(),
      rules: store.listCompatibilityRules(), pending: store.listPendingDonations(),
      donorGroups: store.donorGroupSummary(), requestCounts: store.requestStatusCounts(),
      audit: store.all('SELECT * FROM AuditLog ORDER BY log_id DESC LIMIT 15')
    })],
    adminSetStatus: ['admin', ({ body }) => store.transaction(() =>
      store.updateRequestStatus(integer(body.id), choice(body.status, statuses)))],
    adminDeleteDonor: ['admin', ({ body }) => store.transaction(() => store.deleteDonorAccount(integer(body.id)))],
    adminDeleteRequest: ['admin', ({ body }) => store.transaction(() => store.deleteRequest(integer(body.id)))],
    adminReview: ['admin', ({ body }) => store.transaction(() =>
      store.reviewDonation(integer(body.id), choice(body.decision, ['approved', 'rejected'])))],
    adminResetPassword: ['admin', resetPassword],
    adminReset: ['admin', ({ body }) => {
      if (body.confirm !== 'RESET DATA') invalid('Confirm the database reset.');
      return store.transaction(() => {
        store.db.exec(`
          DELETE FROM Session; DELETE FROM DonationMatch; DELETE FROM Donation;
          DELETE FROM Request; DELETE FROM Donor; DELETE FROM Users WHERE role = 'donor';
          UPDATE BloodStock SET units = 0; DELETE FROM AuditLog;`);
        return { ok: true };
      });
    }],
    adminExport: ['admin', async ({ exportDatabase }) => exportDatabase()]
  }));
}
