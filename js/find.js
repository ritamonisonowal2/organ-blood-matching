/* ============================================================
   find.js — PUBLIC donor search (no login needed).
   Results update live as the person picks a group; contacting
   donors creates a Request and reveals the donors' phone numbers.
   ============================================================ */

const state = { type: 'blood', group: '', organ: 'kidney', city: '' };
let results = [];

document.addEventListener('DOMContentLoaded', start);

async function start() {
  await initDatabase();
  mountUserChip();

  /* prefill from the home-page quick search (?type=&group=&organ=&city=) */
  const q = new URLSearchParams(location.search);
  if (q.get('type') === 'organ') state.type = 'organ';
  if (BLOOD_GROUPS.includes(q.get('group'))) state.group = q.get('group');
  if (q.get('organ')) state.organ = q.get('organ');
  if (q.get('city')) state.city = q.get('city');

  el('loading').style.display = 'none';
  el('content').style.display = 'flex';

  el('f-city').value = state.city;
  el('f-organ').value = state.organ;

  el('type-segment').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    state.type = b.dataset.type;
    drawControls(); search();
  });
  el('f-organ').addEventListener('change', () => { state.organ = el('f-organ').value; search(); });
  el('f-city').addEventListener('input',   () => { state.city  = el('f-city').value.trim(); search(); });

  el('btn-contact').addEventListener('click', () => openContact(true));
  el('btn-post').addEventListener('click', (e) => { e.preventDefault(); openContact(false); });
  el('mc-submit').addEventListener('click', submitContact);

  drawControls();
  search();
  renderOpenRequests();
}

/* ---------- controls ---------- */

function drawControls() {
  document.querySelectorAll('#type-segment button').forEach(b =>
    b.classList.toggle('active', b.dataset.type === state.type));
  el('f-organ-wrap').style.display = state.type === 'organ' ? '' : 'none';

  el('f-groups').innerHTML = BLOOD_GROUPS.map(g =>
    `<button type="button" class="${g === state.group ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`).join('');
  el('f-groups').querySelectorAll('button').forEach(b =>
    b.onclick = () => { state.group = b.dataset.g; drawControls(); search(); });
}

/* ---------- live search ---------- */

function search() {
  const box = el('res-box');
  el('btn-contact').style.display = 'none';
  el('post-hint').style.display = 'none';

  if (!state.group) {
    results = [];
    el('res-count').textContent = '';
    el('res-title').textContent = '🎯 Donors';
    box.innerHTML = emptyState('👆', 'Pick a blood group to begin',
      'Matching donors appear here instantly — no sign-up, no forms.');
    return;
  }

  results = searchDonors({ type: state.type, bloodGroup: state.group, organ: state.organ, city: state.city });
  const what = state.type === 'organ' ? `${state.organ} donors for ${state.group}` : `donors for ${state.group}`;
  el('res-title').textContent = `🎯 ${what.charAt(0).toUpperCase() + what.slice(1)}`;
  el('res-count').textContent = `${results.length} found`;
  el('post-hint').style.display = '';

  if (!results.length) {
    box.innerHTML = emptyState('🔍', 'No compatible donor is available right now',
      'You can post an open request below — registered donors will see it on their dashboard.');
    return;
  }

  el('btn-contact').style.display = '';
  box.innerHTML = `
    <table class="table">
      <thead><tr><th></th><th>Rank</th><th>Donor</th><th>Group</th><th>Gives</th><th>Age</th><th>City</th></tr></thead>
      <tbody>
        ${results.map((m, i) => `
          <tr>
            <td><input type="checkbox" class="pick" value="${m.donor_id}" ${i < 3 ? 'checked' : ''}></td>
            <td><span class="badge ${m.match_rank === 0 ? 'badge-fulfilled' : 'badge-matched'}">#${i + 1}</span></td>
            <td><b>${esc(m.display_name)}</b><br><span style="font-size:12px;color:var(--muted)">${esc(m.match_type)}</span></td>
            <td><span class="badge badge-group">${esc(m.blood_group)}</span></td>
            <td style="text-transform:capitalize">${esc(m.organ)}</td>
            <td class="num">${m.age}</td>
            <td>${esc(m.city)}${m.same_city ? ' <span class="badge badge-available">same city</span>' : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------- open requests (so visitors also see the wider picture) ---------- */

function renderOpenRequests() {
  const rows = listRequests().filter(r => r.status === 'pending' || r.status === 'matched').slice(0, 6);
  el('open-box').innerHTML = rows.length ? `
    <table class="table">
      <thead><tr><th>Needed at</th><th>Need</th><th>Group</th><th>Units</th><th>Urgency</th><th>City</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr class="${r.urgency === 'critical' ? 'row-critical' : ''}">
          <td><b>${esc(reqPlace(r))}</b></td>
          <td>${typeBadge(r.type)}${r.type === 'organ' ? ` <b style="text-transform:capitalize">${esc(r.organ)}</b>` : ''}</td>
          <td><span class="badge badge-group">${esc(r.blood_group)}</span></td>
          <td class="num">${r.units}</td>
          <td>${urgencyBadge(r.urgency)}</td>
          <td>${esc(r.city)}</td>
        </tr>`).join('')}</tbody>
    </table>`
    : emptyState('🕊️', 'No open requests', 'Everything has been fulfilled for now.');
}

/* ---------- contact / post request ---------- */

let contactDonorIds = [];

function openContact(withDonors) {
  if (!state.group) return;
  contactDonorIds = withDonors
    ? Array.from(document.querySelectorAll('.pick:checked')).map(c => parseInt(c.value, 10)) : [];

  if (withDonors && !contactDonorIds.length) { toast('Tick at least one donor first.', 'warn'); return; }

  const need = state.type === 'organ' ? `${state.organ} (patient ${state.group})` : `${state.group} blood`;
  el('mc-title').textContent = withDonors ? '📞 Contact donors' : '📣 Post an open request';
  el('mc-summary').innerHTML = withDonors
    ? `Needed: <b>${esc(need)}</b> · contacting <b>${contactDonorIds.length}</b> donor${contactDonorIds.length > 1 ? 's' : ''}`
    : `Needed: <b>${esc(need)}</b> · compatible donors will see this on their dashboard`;
  el('mc-submit').textContent = withDonors ? 'Show contact numbers' : 'Post request';
  el('mc-city').value = state.city;
  el('mc-error').classList.remove('show');
  el('mc-form-wrap').style.display = '';
  el('mc-done-wrap').style.display = 'none';
  openModal('modal-contact');
}

function submitContact() {
  const err = el('mc-error'); err.classList.remove('show');
  const fail = (m) => { err.textContent = m; err.classList.add('show'); };

  const name = el('mc-name').value.trim(), phone = el('mc-phone').value.trim();
  const city = el('mc-city').value.trim(), units = parseInt(el('mc-units').value, 10);

  if (name.length < 2)         return fail('Please enter your name.');
  if (!/^\d{10}$/.test(phone)) return fail('Phone number must be exactly 10 digits.');
  if (!city)                   return fail('Please enter the city.');
  if (!units || units < 1)     return fail('Units must be at least 1.');

  const res = contactDonors({
    requesterName: name, requesterPhone: phone, hospitalName: el('mc-hospital').value,
    city, type: state.type, bloodGroup: state.group, organ: state.organ,
    units, urgency: el('mc-urgency').value
  }, contactDonorIds);

  el('mc-form-wrap').style.display = 'none';
  el('mc-done-wrap').style.display = '';
  el('mc-title').textContent = contactDonorIds.length ? '✅ Donor contacts' : '✅ Request posted';

  el('mc-done').innerHTML = contactDonorIds.length ? `
    <p style="margin-bottom:12px">Request <b>#${res.requestId}</b> saved. Call these donors now — they can see your request too:</p>
    <table class="table">
      <thead><tr><th>Donor</th><th>Group</th><th>City</th><th>Phone</th></tr></thead>
      <tbody>${res.donors.map(d => `
        <tr><td><b>${esc(d.full_name)}</b></td>
            <td><span class="badge badge-group">${esc(d.blood_group)}</span></td>
            <td>${esc(d.city)}</td>
            <td><a href="tel:${esc(d.phone || '')}">${esc(d.phone || '—')}</a></td></tr>`).join('')}
      </tbody>
    </table>`
    : `<p>Request <b>#${res.requestId}</b> is live. Compatible donors will see it on their dashboard and can call you on
       <b>${esc(phone)}</b>.</p>`;

  search();            // donors just linked drop out of the list
  renderOpenRequests();
}

/* ---------- track / cancel my request (v6) ---------- */
document.addEventListener('DOMContentLoaded', () => {
  el('t-go').addEventListener('click', () => renderTrack(parseInt(el('t-id').value, 10), el('t-phone').value));
});
function renderTrack(id, phone) {
  const o = el('t-out'), t = trackRequest(id, phone);
  if (!t.ok) { o.innerHTML = `<div class="form-error show">${esc(t.error)}</div>`; return; }
  const r = t.request, open = r.status === 'pending' || r.status === 'matched';
  o.innerHTML = `<p>Request <b>#${r.request_id}</b> · ${esc(r.blood_group)} ${esc(r.type)} · ${r.units} unit(s) · ${statusBadge(r.status)}</p>` +
    (t.donors.length
      ? `<table class="table"><thead><tr><th>Donor</th><th>Phone</th></tr></thead><tbody>${t.donors.map(d =>
          `<tr><td>${esc(d.full_name)}</td><td>${esc(d.phone || '—')}</td></tr>`).join('')}</tbody></table>`
      : '<p class="hint">No donor linked yet — compatible donors can see your request on their dashboard.</p>') +
    (open ? '<button class="btn btn-danger btn-sm" id="t-cancel" style="margin-top:10px">Cancel my request</button>' : '');
  if (open) el('t-cancel').addEventListener('click', () => {
    if (!confirm('Cancel this request? This cannot be undone.')) return;
    const res = cancelMyRequest(id, phone);
    if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
    toast('Request cancelled.', 'success');
    renderTrack(id, phone); search(); renderOpenRequests();
  });
}
