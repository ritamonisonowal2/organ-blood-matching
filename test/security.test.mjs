import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/database.mjs';

const admin = { email: 'admin@example.test', fullName: 'Authorized Admin', password: 'admin test password 1234' };
const donor = { email: 'donor@example.test', fullName: 'Test Donor', password: 'donor test password 1234' };
const second = { email: 'second@example.test', fullName: 'Other Donor', password: 'other test password 1234' };
const origin = 'https://organ-blood-matching.netlify.app';

test('LifeLink authorization, privacy and shared database', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lifelink-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'test.sqlite');
  const provision = (email = admin.email) => spawnSync(process.execPath, ['server/provision-admin.mjs'], {
    env: {
      ...process.env, LIFELINK_DB_PATH: file, LIFELINK_ADMIN_EMAIL: email,
      LIFELINK_ADMIN_NAME: admin.fullName, LIFELINK_ADMIN_PASSWORD: admin.password
    },
    encoding: 'utf8'
  });
  const created = provision();
  assert.equal(created.status, 0, created.stderr);
  assert.equal(provision('different@example.test').status, 1);
  const store = openDatabase(file);
  const server = createApp(store, { production: true, origins: [origin] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.db.close();
  });
  const url = 'http://127.0.0.1:' + server.address().port;
  async function post(name, body = {}, cookie = '', headers = {}) {
    const response = await fetch(url + '/api/' + name, {
      method: 'POST', headers: { 'content-type': 'application/json', origin, cookie, ...headers },
      body: JSON.stringify(body)
    });
    const isJson = response.headers.get('content-type').startsWith('application/json');
    return {
      status: response.status, headers: response.headers,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      data: isJson ? await response.json() : Buffer.from(await response.arrayBuffer())
    };
  }

  let adminCookie;
  let donorCookie;
  let secondCookie;
  let donorId;
  let donationId;
  let request;
  const profile = { bloodGroup: 'O-', organ: 'blood', age: 30, city: 'Test City', phone: '5550100101' };

  await t.test('public registration creates donors only and cookies carry an opaque session', async () => {
    assert.equal((await post('register', { ...second, role: 'admin' })).status, 403);
    assert.equal((await post('register', donor)).status, 200);
    assert.equal((await post('register', second)).status, 200);
    const a = await post('login', { ...admin, remember: true });
    assert.equal(a.status, 200);
    assert.equal(a.data.user.role, 'admin');
    assert.equal(a.data.user.password, undefined);
    assert.match(a.headers.get('set-cookie'), /^__Host-lifelink_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=/);
    adminCookie = a.cookie;
    donorCookie = (await post('login', donor)).cookie;
    secondCookie = (await post('login', second)).cookie;
    assert.ok(donorCookie && secondCookie);
    assert.equal((await post('session', {}, donorCookie)).data.role, 'donor');
    const freshConnection = openDatabase(file);
    assert.equal(freshConnection.one('SELECT COUNT(*) AS total FROM Users').total, 3);
    freshConnection.db.close();
  });

  await t.test('every admin operation requires an authorized admin session', async () => {
    for (const name of [
      'adminOverview', 'adminSetStatus', 'adminDeleteDonor', 'adminDeleteRequest',
      'adminReview', 'adminResetPassword', 'adminReset', 'adminExport'
    ]) {
      assert.equal((await post(name)).status, 401, name);
      assert.equal((await post(name, {}, donorCookie)).status, 403, name);
    }
    assert.equal((await post('adminOverview', {}, adminCookie, { origin: 'https://other.example.test' })).status, 403);
    assert.equal((await post('adminReset', {}, adminCookie)).status, 422);
    assert.equal((await post('adminOverview', {}, adminCookie)).status, 200);
  });

  await t.test('donor operations are limited to the signed-in donor and writes validate input', async () => {
    assert.equal((await post('saveProfile', profile, donorCookie)).status, 200);
    const me = (await post('donorProfile', {}, donorCookie)).data;
    donorId = me.donor_id;
    assert.equal((await post('saveProfile', { ...profile, phone: '5550100102', userId: me.user_id }, secondCookie)).status, 200);
    assert.equal((await post('donorProfile', { userId: me.user_id }, secondCookie)).data.phone, '5550100102');
    assert.equal((await post('donorProfile', {}, donorCookie)).data.phone, profile.phone);
    assert.equal((await post('recordDonation', { units: -1 }, donorCookie)).status, 422);
    assert.equal((await post('recordDonation', { units: 3 }, donorCookie)).data.ok, true);
    const pending = (await post('adminOverview', {}, adminCookie)).data.pending;
    assert.equal(pending.length, 1);
    donationId = pending[0].donation_id;
    assert.equal((await post('donationHistory', { donorId }, secondCookie)).data.length, 0);
  });

  await t.test('public requests reveal contact details only after consent and require a tracking code', async () => {
    const query = { type: 'blood', bloodGroup: 'O-', city: profile.city };
    const search = (await post('search', query)).data;
    assert.equal(search.length, 2);
    assert.equal(search[0].phone, undefined);
    const form = { ...query, requesterName: 'Test Requester', requesterPhone: '5550100103', units: 2, urgency: 'urgent' };
    assert.equal((await post('postRequest', { ...form, donorIds: [9999] })).status, 409);
    request = (await post('postRequest', { ...form, donorIds: [donorId] })).data;
    assert.equal(request.ok, true);
    assert.equal(request.trackingCode.length, 43);
    assert.equal(request.donors, undefined);
    const publicRow = (await post('openRequests')).data[0];
    assert.equal(publicRow.requester_name, undefined);
    assert.equal(publicRow.requester_phone, undefined);
    const credentials = { id: request.requestId, code: request.trackingCode };
    assert.equal((await post('trackRequest', { ...credentials, code: 'Z'.repeat(43) })).status, 404);
    assert.equal((await post('trackRequest', credentials)).data.donors.length, 0);
    assert.equal((await post('donorRequests', {}, donorCookie)).data[0].requester_phone, undefined);
    assert.equal((await post('acceptRequest', { id: request.requestId }, secondCookie)).status, 409);
    assert.equal((await post('acceptRequest', { id: request.requestId }, donorCookie)).status, 200);
    assert.equal((await post('trackRequest', credentials)).data.donors[0].phone, profile.phone);
    assert.equal((await post('donorRequests', {}, donorCookie)).data[0].requester_phone, form.requesterPhone);
    assert.equal((await post('donorRequests', {}, secondCookie)).data[0].requester_phone, undefined);
    const open = (await post('postRequest', { ...form, donorIds: [] })).data;
    assert.equal((await post('cancelRequest', { id: open.requestId, code: open.trackingCode })).data.ok, true);
  });

  await t.test('admin approval updates stock only once, and revocation invalidates sessions', async () => {
    assert.equal((await post('adminReview', { id: donationId, decision: 'approved' }, adminCookie)).data.ok, true);
    assert.equal((await post('adminReview', { id: donationId, decision: 'approved' }, adminCookie)).data.ok, false);
    const fulfill = { id: request.requestId, status: 'fulfilled' };
    assert.equal((await post('adminSetStatus', fulfill, adminCookie)).data.ok, true);
    assert.equal((await post('adminSetStatus', fulfill, adminCookie)).data.ok, true);
    const publicStats = (await post('publicOverview')).data;
    assert.equal(publicStats.stock.find(row => row.blood_group === 'O-').units, 1);
    const backup = await post('adminExport', {}, adminCookie);
    assert.equal(backup.status, 200);
    assert.equal(backup.data.subarray(0, 15).toString(), 'SQLite format 3');
    const id = (await post('session', {}, donorCookie)).data.user_id;
    assert.equal((await post('adminResetPassword', { id, password: 'replacement test password' }, adminCookie)).data.ok, true);
    assert.equal((await post('donorProfile', {}, donorCookie)).status, 401);
    assert.equal((await post('logout', {}, secondCookie)).status, 200);
    assert.equal((await post('donorProfile', {}, secondCookie)).status, 401);
    assert.equal((await post('adminReset', { confirm: 'RESET DATA' }, adminCookie)).data.ok, true);
    assert.equal((await post('adminOverview', {}, adminCookie)).status, 401);
    assert.equal(store.one("SELECT COUNT(*) AS total FROM Users WHERE role = 'admin'").total, 1);
    assert.equal(store.one('SELECT COUNT(*) AS total FROM Request').total, 0);
  });

  await t.test('static responses keep private files out and set a restrictive browser policy', async () => {
    const page = await fetch(url + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(page.headers.get('strict-transport-security'), /max-age=/);
    const loginPage = await fetch(url + '/login.html');
    assert.doesNotMatch(await loginPage.text(), /Set up the administrator account/i);
    assert.equal((await fetch(url + '/server/schema.sql')).status, 404);
    assert.equal((await fetch(url + '/data/lifelink.sqlite')).status, 404);
    assert.equal((await post('session', {}, '', { 'content-type': 'text/plain' })).status, 415);
  });
});
