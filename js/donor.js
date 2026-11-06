/* ============================================================
   donor.js — donor dashboard logic
   ============================================================ */

let me = null;          // donor row (joined with Users)
let session = null;

document.addEventListener('DOMContentLoaded', start);

async function start() {
  session = await bootPage('donor');
  if (!session) return;

  el('btn-delete-account').addEventListener('click', () => {
    if (!confirm('Delete your account permanently? Your profile, donation history and login will be removed. This cannot be undone.')) return;
    const res = deleteDonorAccount(session.user_id);
    if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
    clearSession();
    location.href = 'index.html';
  });

  me = getDonorByUser(session.user_id);
  if (!me) { showOnboarding(); return; }   // new account → suggestions first, details second

  el('loading').style.display = 'none';
  el('onboard').style.display = 'none';
  el('content').style.display = '';

  /* time-based greeting */
  const h = new Date().getHours();
  el('greet-word').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  el('greet-name').textContent = me.full_name.split(' ')[0];

  renderProfile();
  renderRequests();
  renderDonations();
  renderTip();

  el('btn-refresh').addEventListener('click', () => {
    renderRequests();
    toast('Requests refreshed', 'info');
  });

  if (me.organ === 'blood') {
    el('btn-record').addEventListener('click', openDonateModal);
  } else {
    el('btn-record').style.display = 'none';   // organ pledges don't add to blood stock
  }

  el('donate-save').addEventListener('click', saveDonation);
}

/* ---------- first-time donor: suggestions first, details second ---------- */

function showOnboarding() {
  el('loading').style.display = 'none';
  el('content').style.display = 'none';
  el('onboard').style.display = '';
  el('btn-record').style.display = 'none';
  el('greet-name').textContent = (session.full_name || 'donor').split(' ')[0];
  const h = new Date().getHours();
  el('greet-word').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.querySelector('.page-head p').textContent =
    'Welcome! Choose your blood group to see who needs you — then save your details to get matched.';

  let group = '';
  const draw = () => {
    el('ob-groups').innerHTML = BLOOD_GROUPS.map(g =>
      `<button type="button" class="${g === group ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`).join('');
    el('ob-groups').querySelectorAll('button').forEach(b => b.onclick = () => { group = b.dataset.g; draw(); suggest(); });
  };

  function suggest() {
    const box = el('sug-box');
    if (!group) {
      el('sug-count').textContent = '';
      box.innerHTML = emptyState('👆', 'Pick your blood group', 'We will show every open request you could help with — before you fill in anything else.');
      return;
    }
    const rows = suggestRequests(group, el('ob-organ').value, el('ob-city').value.trim());
    el('sug-count').textContent = `${rows.length} request${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      box.innerHTML = emptyState('🕊️', 'No open requests for this choice right now',
        'Save your details anyway — you will be matched the moment someone needs you.');
      return;
    }
    const city = el('ob-city').value.trim().toLowerCase();
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>Needed at</th><th>Need</th><th>Group</th><th>Units</th><th>Urgency</th><th>Match</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr class="${r.urgency === 'critical' ? 'row-critical' : ''}">
            <td><b>${esc(reqPlace(r))}</b><br><span style="font-size:12px;color:var(--muted)">${esc(r.city)}${city && r.city.toLowerCase() === city ? ' · near you' : ''}</span></td>
            <td>${typeBadge(r.type)}${r.type === 'organ' ? ` <b style="text-transform:capitalize">${esc(r.organ)}</b>` : ''}</td>
            <td><span class="badge badge-group">${esc(r.blood_group)}</span></td>
            <td class="num">${r.units}</td>
            <td>${urgencyBadge(r.urgency)}</td>
            <td>${r.priority === 0 ? '<span class="badge badge-fulfilled">Full match</span>' : '<span class="badge badge-urgency-urgent">Partial match</span>'}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  draw(); suggest();
  el('ob-organ').addEventListener('change', suggest);
  el('ob-city').addEventListener('input', suggest);

  el('ob-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = el('ob-error'); err.classList.remove('show');
    const fail = (m) => { err.textContent = m; err.classList.add('show'); };
    const age = parseInt(el('ob-age').value, 10);
    const phone = el('ob-phone').value.trim();
    if (!group)                          return fail('Please pick your blood group.');
    if (!el('ob-city').value.trim())     return fail('Please enter your city.');
    if (!age || age < 18 || age > 65)    return fail('Age must be between 18 and 65.');
    if (phone && !/^\d{10}$/.test(phone)) return fail('Phone number must be exactly 10 digits (or leave it empty).');

    saveDonorProfile(session.user_id, { bloodGroup: group, organ: el('ob-organ').value,
                                        age, city: el('ob-city').value.trim(), phone });
    toast('Profile saved — you are now visible to people searching for donors 🎉', 'success');
    location.reload();
  });
}

function openDonateModal() {
  el('donate-summary').innerHTML = `
    <div class="kv" style="margin-bottom:14px">
      <dt>Donor</dt><dd>${esc(me.full_name)}</dd>
      <dt>Blood group</dt><dd><span class="badge badge-group">${esc(me.blood_group)}</span></dd>
    </div>`;
  openModal('modal-donate');
}

/* ---------- profile card ---------- */

function renderProfile() {
  const initials = me.full_name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  el('profile-box').innerHTML = `
    <div style="display:flex; gap:14px; align-items:center; margin-bottom:16px">
      <div class="avatar">${esc(initials)}</div>
      <div>
        <div style="font-weight:750; font-size:16.5px; color:var(--brown)">${esc(me.full_name)}</div>
        <div style="font-size:13px; color:var(--muted)">${esc(me.email)}</div>
      </div>
    </div>
    <dl class="kv">
      <dt>Blood group</dt><dd><span class="badge badge-group">${esc(me.blood_group)}</span></dd>
      <dt>Donates</dt><dd style="text-transform:capitalize">${esc(me.organ)}</dd>
      <dt>Age</dt><dd>${esc(me.age)} years</dd>
      <dt>City</dt><dd>${esc(me.city)}</dd>
      <dt>Phone</dt><dd>${esc(me.phone || '—')}</dd>
      <dt>Last donation</dt><dd>${fmtDate(me.last_donation_date)}</dd>
      <dt>Availability</dt>
      <dd>
        <label class="switch" title="People can only find you while you are available">
          <input type="checkbox" id="avail-switch" ${me.available ? 'checked' : ''}>
          <span class="track"></span>
        </label>
        <span id="avail-label" style="margin-left:8px">${me.available
          ? '<span class="badge badge-available">Available</span>'
          : '<span class="badge badge-unavailable">Unavailable</span>'}</span>
      </dd>
    </dl>
    <button class="btn btn-outline btn-sm" id="btn-edit" style="margin-top:14px">✏️ Edit profile</button>`;

  el('btn-edit').addEventListener('click', openEdit);
  el('avail-switch').addEventListener('change', (e) => {
    setDonorAvailability(me.donor_id, e.target.checked);
    me.available = e.target.checked ? 1 : 0;
    el('avail-label').innerHTML = me.available
      ? '<span class="badge badge-available">Available</span>'
      : '<span class="badge badge-unavailable">Unavailable</span>';
    toast(me.available
      ? 'You are now visible to the matching engine ✅'
      : 'You are hidden from matching until you switch back', me.available ? 'success' : 'warn');
    renderRequests();
  });
}

/* ---------- open compatible requests ---------- */

function renderRequests() {
  const box = el('requests-box');
  const rows = openRequestsForDonor(me);

  el('req-count').textContent = `${rows.length} result${rows.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    box.innerHTML = emptyState('🕊️', 'No open requests for your profile right now',
      `When someone needs ${esc(me.blood_group)}${me.organ !== 'blood' ? ` or a ${esc(me.organ)} donor` : ''}, it will appear here automatically.`);
    return;
  }

  box.innerHTML = `
    <table class="table">
      <thead>
        <tr><th>Needed at</th><th>Need</th><th>Group</th><th>Units</th><th>Urgency</th><th>Match</th><th>Contact</th><th>City</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="${r.urgency === 'critical' ? 'row-critical' : ''}">
            <td><b>${esc(reqPlace(r))}</b></td>
            <td>${typeBadge(r.type)}${r.type === 'organ' ? ` <b style="text-transform:capitalize">${esc(r.organ)}</b>` : ''}</td>
            <td><span class="badge badge-group">${esc(r.blood_group)}</span></td>
            <td class="num">${r.units}</td>
            <td>${urgencyBadge(r.urgency)}</td>
            <td>${r.priority === 0
                  ? '<span class="badge badge-fulfilled">Full match</span>'
                  : '<span class="badge badge-urgency-urgent">Partial match</span>'}</td>
            <td>${esc(r.requester_name)}<br><a href="tel:${esc(r.requester_phone)}">${esc(r.requester_phone)}</a></td>
            <td>${esc(r.city)}${r.city === me.city ? ' <span class="badge badge-available">near you</span>' : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------- contextual donor tip (e.g. universal donor) ---------- */

function renderTip() {
  const box = el('tip-box');
  let icon, title, text;

  if (me.blood_group === 'O-') {
    icon = '🌟'; title = "You're a universal donor";
    text = 'O− blood can be given to every recipient group — your donations are the most requested of all.';
  } else if (me.blood_group === 'AB+') {
    icon = '🧲'; title = "You're a universal recipient";
    text = 'AB+ can receive blood from every group — and AB plasma can help every patient too.';
  } else {
    const recips = recipientGroupsFor(me.blood_group);
    icon = '💞';
    title = `${me.blood_group} helps ${recips.length} recipient group${recips.length === 1 ? '' : 's'}`;
    text = `Your blood can be given to patients with: ${recips.join(', ')}.`;
  }

  box.innerHTML = `
    <div class="tip-card">
      <div class="tip-emoji">${icon}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      <div class="tip-actions">
        <button class="btn btn-outline btn-sm" id="tip-view">View matching requests</button>
        ${me.organ === 'blood' ? '<button class="btn btn-primary btn-sm" id="tip-donate">＋ Record donation</button>' : ''}
      </div>
    </div>`;

  el('tip-view').addEventListener('click', () => {
    el('requests-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if (el('tip-donate')) el('tip-donate').addEventListener('click', openDonateModal);
}

/* ---------- donation history ---------- */

function renderDonations() {
  const box = el('donations-box');
  const rows = listDonationsForDonor(me.donor_id);

  el('donation-count').textContent = rows.length ? `${rows.length} donation${rows.length > 1 ? 's' : ''}` : '';

  if (!rows.length) {
    box.innerHTML = emptyState('🩺', 'No donations recorded yet',
      'Tap “Record a donation” after you donate — the stock level updates on its own.');
    return;
  }

  box.innerHTML = `
    <table class="table">
      <thead><tr><th>Date</th><th>Blood group</th><th>Units</th><th>Status</th></tr></thead>
      <tbody>
        ${rows.map(d => `
          <tr>
            <td style="white-space:nowrap">${fmtDateTime(d.donation_date)}</td>
            <td><span class="badge badge-group">${esc(d.blood_group)}</span></td>
            <td class="num">${d.units}</td>
            <td><span class="badge badge-${d.status === 'approved' ? 'fulfilled' : d.status === 'rejected' ? 'cancelled' : 'pending'}">${esc(d.status)}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------- record donation (fires the TRIGGER) ---------- */

function saveDonation() {
  const units = parseInt(el('donate-units').value, 10);

  /* eligibility guard — whole blood can normally be donated only every ~90 days */
  if (me.last_donation_date) {
    const days = Math.floor((Date.now() - new Date(String(me.last_donation_date).replace(' ', 'T')).getTime()) / 864e5);
    if (days < 90 && !confirm(`Your last donation was ${days} day${days === 1 ? '' : 's'} ago. Whole blood can normally be donated once every 90 days — record this donation anyway?`)) {
      return;
    }
  }

  const res = recordDonation(me.donor_id, units);
  if (!res.ok) { toast(esc(res.error), 'error'); return; }

  closeModal('modal-donate');
  toast('✅ Donation recorded — waiting for admin approval. Stock updates once it is approved.', 'success');

  me = getDonorByUser(session.user_id);   // refresh last_donation_date
  renderProfile();
  renderDonations();
}

/* ---------- edit profile ---------- */
function openEdit() {
  el('ep-group').innerHTML = BLOOD_GROUPS.map(g => `<option ${g === me.blood_group ? 'selected' : ''}>${esc(g)}</option>`).join('');
  el('ep-organ').value = me.organ; el('ep-city').value = me.city;
  el('ep-age').value = me.age;     el('ep-phone').value = me.phone || '';
  el('ep-error').classList.remove('show');
  el('ep-save').onclick = saveEdit;
  openModal('modal-edit');
}
function saveEdit() {
  const err = el('ep-error'), fail = (m) => { err.textContent = m; err.classList.add('show'); };
  const age = parseInt(el('ep-age').value, 10), phone = el('ep-phone').value.trim(), city = el('ep-city').value.trim();
  if (!city) return fail('Please enter your city.');
  if (!age || age < 18 || age > 65) return fail('Age must be between 18 and 65.');
  if (phone && !/^\d{10}$/.test(phone)) return fail('Phone number must be exactly 10 digits (or leave it empty).');
  saveDonorProfile(session.user_id, { bloodGroup: el('ep-group').value, organ: el('ep-organ').value, age, city, phone });
  toast('Profile updated ✅', 'success');
  setTimeout(() => location.reload(), 600);
}
