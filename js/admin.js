/* ============================================================
   admin.js — admin console: stats, charts, tables, tools
   ============================================================ */

let session = null;
const charts = {};   // Chart.js instances

/* BLOOD_GROUPS comes from db.js (shared global) */

/* doughnut centre label — shows the total request count */
const doughnutCenter = {
  id: 'doughnutCenter',
  afterDraw(chart) {
    if (chart.config.type !== 'doughnut') return;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data || !meta.data.length) return;
    const { x, y } = meta.data[0];
    const ctx = chart.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "700 26px Georgia, 'Times New Roman', serif";
    ctx.fillStyle = '#1d1815';
    ctx.fillText(String(chart.options.plugins.doughnutCenter?.value ?? ''), x, y);
    ctx.restore();
  }
};
Chart.register(doughnutCenter);
Chart.defaults.color = '#5f5247';
Chart.defaults.borderColor = 'rgba(35,28,23,.08)';

document.addEventListener('DOMContentLoaded', start);

async function start() {
  session = await bootPage('admin');
  if (!session) return;

  el('loading').style.display = 'none';
  el('content').style.display = '';

  renderAll();

  el('btn-export').addEventListener('click', () => {
    downloadDatabaseFile();
    toast('Backup downloaded as <b>lifelink.sqlite</b>.', 'success');
  });

  el('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset the system? All accounts, donors, requests, donations and stock are permanently deleted, and the platform returns to a clean state.')) return;
    await resetDatabase();          // also clears the saved login
    location.href = 'index.html';   // back to the home page
  });
}

function renderAll() {
  renderStats();
  renderCritical();
  renderRequestsTable();
  renderDonorsTable();
  renderUsersTable();
  renderCompatTable();
  renderPendingDonations();
  renderAudit();
  drawCharts();
}

/* ---------- stat cards + alerts ---------- */

function renderStats() {
  const s = dashboardStats();

  el('stat-grid').innerHTML = `
    <div class="stat-card"><div class="stat-icon red">🩸</div>
      <div><div class="stat-value">${s.totalDonors}</div><div class="stat-label">Registered donors</div></div></div>
    <div class="stat-card"><div class="stat-icon green">✅</div>
      <div><div class="stat-value">${s.availableDonors}</div><div class="stat-label">Available now</div></div></div>
    <div class="stat-card"><div class="stat-icon blue">🚑</div>
      <div><div class="stat-value">${s.totalRequests}</div><div class="stat-label">Total requests</div></div></div>
    <div class="stat-card"><div class="stat-icon navy">📦</div>
      <div><div class="stat-value">${s.totalUnits}</div><div class="stat-label">Units in stock</div></div></div>
    <div class="stat-card"><div class="stat-icon amber">⏳</div>
      <div><div class="stat-value">${s.pendingRequests}</div><div class="stat-label">Pending requests</div></div></div>
    <div class="stat-card"><div class="stat-icon red">🔴</div>
      <div><div class="stat-value">${s.criticalRequests}</div><div class="stat-label">Critical requests</div></div></div>
    <div class="stat-card"><div class="stat-icon green">🏆</div>
      <div><div class="stat-value">${s.fulfilledRequests}</div><div class="stat-label">Fulfilled requests</div></div></div>
    <div class="stat-card"><div class="stat-icon navy">💉</div>
      <div><div class="stat-value">${s.totalDonations}</div><div class="stat-label">Donations approved</div></div></div>`;

  /* low-stock alert */
  const low = getStock().filter(r => r.stock_status !== 'OK');
  el('alert-slot').innerHTML = low.length
    ? `<div class="alert alert-danger">⚠️ <span>
         <b>Low stock warning:</b>&nbsp; ${low.map(r =>
           `<span class="badge badge-group">${esc(r.blood_group)}</span> ${r.units} unit${r.units === 1 ? '' : 's'} (${esc(r.stock_status === 'OUT' ? 'out of stock' : 'below threshold')})`).join(' &nbsp; ')}
       </span></div>`
    : `<div class="alert alert-info">✅ <span>All blood groups are above their low-stock threshold.</span></div>`;
}

/* ---------- critical requests (VIEW) ---------- */

function renderCritical() {
  const rows = criticalRequests();
  el('critical-box').innerHTML = rows.length ? `
    <table class="table">
      <thead><tr><th>#</th><th>Requested by</th><th>Place</th><th>Need</th><th>Group</th><th>Units</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr class="row-critical">
            <td class="num">${r.request_id}</td>
            <td><b>${esc(r.requester_name)}</b><br><span style="font-size:12px;color:var(--muted)">${esc(r.requester_phone)}</span></td>
            <td>${esc(r.hospital_name || '—')}<br><span style="font-size:12px;color:var(--muted)">${esc(r.city)}</span></td>
            <td>${typeBadge(r.type)}${r.type === 'organ' ? ` <b style="text-transform:capitalize">${esc(r.organ)}</b>` : ''}</td>
            <td><span class="badge badge-group">${esc(r.blood_group)}</span></td>
            <td class="num">${r.units}</td>
            <td>${statusBadge(r.status)}</td>
            <td style="white-space:nowrap">${fmtDateTime(r.created_at)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`
    : emptyState('🟢', 'No active critical requests', 'Critical requests appear here instantly while they await donors.');
}

/* ---------- all requests (admin can change status) ---------- */

function renderRequestsTable() {
  const rows = listRequests();

  el('requests-box').innerHTML = rows.length ? `
    <table class="table">
      <thead><tr>
        <th>#</th><th>Requested by</th><th>Need</th><th>Group</th><th>Units</th>
        <th>Urgency</th><th>Status</th><th>Created</th><th>Set status</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr class="${r.urgency === 'critical' && r.status !== 'fulfilled' && r.status !== 'cancelled' ? 'row-critical' : ''}">
            <td class="num">${r.request_id}</td>
            <td><b>${esc(r.requester_name)}</b> · ${esc(r.requester_phone)}<br><span style="font-size:12px;color:var(--muted)">${esc(r.hospital_name || '')} ${esc(r.city)} · ${r.match_count} donor${r.match_count === 1 ? '' : 's'} linked</span></td>
            <td>${typeBadge(r.type)}${r.type === 'organ' ? ` <b style="text-transform:capitalize">${esc(r.organ)}</b>` : ''}</td>
            <td><span class="badge badge-group">${esc(r.blood_group)}</span></td>
            <td class="num">${r.units}</td>
            <td>${urgencyBadge(r.urgency)}</td>
            <td>${statusBadge(r.status)}</td>
            <td style="white-space:nowrap">${fmtDateTime(r.created_at)}</td>
            <td>
              <select class="btn btn-outline btn-sm" style="padding:6px 8px"
                      ${(r.status === 'fulfilled' || r.status === 'cancelled') ? 'disabled title="This request is closed"' : ''}
                      onchange="adminSetStatus(${r.request_id}, this)">
                ${['pending','matched','fulfilled','cancelled'].map(s =>
                  `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
            <td><button class="btn btn-danger btn-sm" onclick="adminDeleteRequest(${r.request_id})">Delete</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`
    : emptyState('🗂️', 'No requests in the system yet', 'Requests made through the Find Donor page will appear here.');
}

function adminSetStatus(requestId, selectEl) {
  const res = updateRequestStatus(requestId, selectEl.value);
  if (!res.ok) {
    toast('⚠️ ' + esc(res.error), 'error');
    renderRequestsTable();          // resets the dropdown to the DB value
    return;
  }
  if (res.note) toast('✅ ' + esc(res.note), 'success');
  else toast(`Request #${requestId} → <b>${esc(selectEl.value)}</b>`, 'success');
  renderAll();
}

function adminRemoveDonor(userId, name) {
  if (!confirm(`Delete donor "${name}" permanently? Their profile, donation history and login are removed.`)) return;
  const res = deleteDonorAccount(userId);
  if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
  toast(`Donor <b>${esc(name)}</b> deleted.`, 'success');
  renderAll();
}

function adminDeleteRequest(requestId) {
  if (!confirm(`Delete request #${requestId} permanently?`)) return;
  const res = deleteRequest(requestId);
  if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
  toast(`Request #${requestId} deleted.`, 'success');
  renderAll();
}

/* ---------- donors & users ---------- */

function renderDonorsTable() {
  const rows = listDonors();
  el('donor-count').textContent = rows.length ? `${rows.length} donors` : '';
  el('donors-box').innerHTML = rows.length ? `
    <table class="table">
      <thead><tr><th>Name</th><th>Group</th><th>Organ</th><th>Age</th><th>City</th><th>Phone</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${rows.map(d => `
          <tr>
            <td><b>${esc(d.full_name)}</b><br><span style="font-size:12px;color:var(--muted)">${esc(d.email)}</span></td>
            <td><span class="badge badge-group">${esc(d.blood_group)}</span></td>
            <td style="text-transform:capitalize">${esc(d.organ)}</td>
            <td class="num">${d.age}</td>
            <td>${esc(d.city)}</td>
            <td>${esc(d.phone || '—')}</td>
            <td>${d.available
              ? '<span class="badge badge-available">Available</span>'
              : '<span class="badge badge-unavailable">Unavailable</span>'}</td>
            <td><button class="btn btn-danger btn-sm" onclick="adminRemoveDonor(${d.user_id}, '${esc(d.full_name).replace(/'/g, '')}')">Delete</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`
    : emptyState('🧑‍🤝‍🧑', 'No donors registered yet', 'Donor registrations will appear here.');
}

function renderUsersTable() {
  const rows = listUsers();
  el('user-count').textContent = `${rows.length} account${rows.length === 1 ? '' : 's'}`;
  const roleIcon = { admin: '🛡️', donor: '🩸' };
  el('users-box').innerHTML = `
    <table class="table">
      <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
      <tbody>
        ${rows.map(u => `
          <tr>
            <td class="num">${u.user_id}</td>
            <td><b>${esc(u.full_name)}</b></td>
            <td>${esc(u.email)}</td>
            <td>${roleIcon[u.role] || ''} ${esc(u.role)}</td>
            <td style="white-space:nowrap">${fmtDate(u.created_at)}</td>
            <td style="white-space:nowrap">${u.role === 'admin' ? '' :
              `<button class="btn btn-ghost btn-sm" onclick="resetUserPassword(${u.user_id}, '${esc(u.full_name).replace(/'/g, '')}')">🔑 Reset password</button>`}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function resetUserPassword(userId, name) {
  const pw = prompt(`Set a new password for ${name} (min 6 characters):`);
  if (pw === null) return;
  const res = await adminResetPassword(userId, pw);
  if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
  toast(`Password updated for <b>${esc(name)}</b>.`, 'success');
}

/* ---------- compatibility matrix ---------- */

function renderCompatTable() {
  /* recipient (rows) x donor (columns) grid built from the CompatibilityRule table */
  const rules = listCompatibilityRules();
  const ok = {}; rules.forEach(r => ok[r.recipient_group + '>' + r.donor_group] = r.priority);
  el('compat-box').innerHTML = `
    <table class="table compat-grid">
      <thead>
        <tr><th>Recipient ↓ &nbsp;/&nbsp; Donor →</th>${BLOOD_GROUPS.map(g => `<th style="text-align:center">${esc(g)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${BLOOD_GROUPS.map(rec => `
          <tr>
            <td><span class="badge badge-group">${esc(rec)}</span></td>
            ${BLOOD_GROUPS.map(don => {
              const k = rec + '>' + don;
              return k in ok
                ? `<td style="text-align:center;color:${rec === don ? 'var(--mint)' : 'var(--ink)'};font-weight:${rec === don ? 800 : 500}" title="${esc(don)} can donate to ${esc(rec)}">✓</td>`
                : `<td style="text-align:center;color:var(--muted);opacity:.35">–</td>`;
            }).join('')}
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------- charts (Chart.js) ---------- */

function drawCharts() {
  const RED = '#c4402f';

  /* donors by group — two GROUP BY datasets from the summary VIEW */
  const dg = donorGroupSummary();
  const donorLabels = BLOOD_GROUPS.filter(g => dg.some(r => r.blood_group === g));
  const dgMap = Object.fromEntries(dg.map(r => [r.blood_group, r]));
  makeChart('chart-donors', 'bar', donorLabels, [
    { label: 'Total',     data: donorLabels.map(g => dgMap[g].total_donors),     backgroundColor: RED },
    { label: 'Available', data: donorLabels.map(g => dgMap[g].available_donors), backgroundColor: '#d8c9b0' }
  ]);

  /* requests by status — GROUP BY, total shown in the doughnut centre */
  const rs = requestStatusCounts();
  const statusColors = { pending: '#d9a93a', matched: '#4a6f93', fulfilled: '#5b7f4a', cancelled: '#a99b8b' };
  const totalRequests = rs.reduce((a, r) => a + r.cnt, 0);
  makeChart('chart-status', 'doughnut', rs.map(r => r.status), [
    { data: rs.map(r => r.cnt), backgroundColor: rs.map(r => statusColors[r.status] || '#6b757c'), borderColor: '#fbf7ef', borderWidth: 3 }
  ], { doughnutCenter: { value: totalRequests } });

  /* stock — colour per low-stock status from the VIEW */
  const st = getStock();
  const barColors = st.map(r =>
    r.stock_status === 'OUT' ? '#c4402f' : r.stock_status === 'LOW' ? '#d9a93a' : '#5b7f4a');
  makeChart('chart-stock', 'bar', st.map(r => r.blood_group), [
    { label: 'Units', data: st.map(r => r.units), backgroundColor: barColors }
  ]);
}

function makeChart(canvasId, type, labels, datasets, extra = {}) {
  if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }

  /* nothing to draw yet → friendly message instead of a blank canvas */
  const canvas = el(canvasId);
  const box = canvas.parentElement;
  let note = box.querySelector('.chart-empty');
  const hasData = datasets.some(d => d.data.some(n => n > 0));
  if (!hasData) {
    if (!note) {
      note = document.createElement('div');
      note.className = 'chart-empty';
      note.textContent = 'No data yet — this chart fills in as the platform is used.';
      box.appendChild(note);
    }
    canvas.style.display = 'none';
    return;
  }
  if (note) note.remove();
  canvas.style.display = '';

  charts[canvasId] = new Chart(el(canvasId), {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: type === 'doughnut' ? 'right' : 'bottom' },
        ...extra
      },
      scales: type === 'doughnut' ? {} : {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(35,28,23,.08)' } }
      }
    }
  });
}

/* ---------- donation approval + audit log (v6) ---------- */
function renderPendingDonations() {
  const rows = listPendingDonations();
  el('pending-box').innerHTML = rows.length ? `
    <table class="table">
      <thead><tr><th>#</th><th>Donor</th><th>Group</th><th>Units</th><th>Recorded</th><th></th></tr></thead>
      <tbody>${rows.map(d => `
        <tr><td class="num">${d.donation_id}</td><td><b>${esc(d.full_name)}</b></td>
            <td><span class="badge badge-group">${esc(d.blood_group)}</span></td><td class="num">${d.units}</td>
            <td style="white-space:nowrap">${fmtDateTime(d.donation_date)}</td>
            <td style="white-space:nowrap"><button class="btn btn-primary btn-sm" onclick="adminReview(${d.donation_id},'approved')">Approve</button>
              <button class="btn btn-danger btn-sm" onclick="adminReview(${d.donation_id},'rejected')">Reject</button></td></tr>`).join('')}
      </tbody></table>`
    : emptyState('✅', 'No donations waiting', 'New donations appear here for your approval.');
}
function adminReview(id, decision) {
  const res = reviewDonation(id, decision);
  if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
  toast(decision === 'approved' ? 'Donation approved — stock updated by the trigger.' : 'Donation rejected.', 'success');
  renderAll();
}
function renderAudit() {
  const rows = listAuditLog();
  el('audit-box').innerHTML = rows.length ? `
    <table class="table">
      <thead><tr><th>When</th><th>Table</th><th>Record</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td style="white-space:nowrap">${fmtDateTime(r.logged_at)}</td><td>${esc(r.table_name)}</td>
        <td class="num">${r.record_id}</td><td>${esc(r.action)}</td><td>${esc(r.old_value)}</td><td><b>${esc(r.new_value)}</b></td></tr>`).join('')}</tbody></table>`
    : emptyState('🧾', 'No changes logged yet', 'Stock and request-status changes are recorded here automatically.');
}
