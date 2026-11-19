/* ============================================================
   admin.js — admin console: stats, charts, tables, tools
   ============================================================ */

let session = null;
let overview = null;
const charts = {};   // Chart.js instances

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
    ctx.fillStyle = chartTheme().ink;
    ctx.fillText(String(chart.options.plugins.doughnutCenter?.value ?? ''), x, y);
    ctx.restore();
  }
};
Chart.register(doughnutCenter);
Chart.defaults.font.family = 'Arial, sans-serif';

document.addEventListener('lifelink:themechange', () => {
  if (!overview) return;
  const theme = chartTheme();
  const donors = charts['chart-donors'];
  if (donors) {
    donors.data.datasets[0].backgroundColor = theme.secondary;
    donors.data.datasets[1].backgroundColor = theme.accent;
  }
  const requests = charts['chart-status'];
  if (requests) {
    requests.data.datasets[0].backgroundColor = requests.data.labels.map(status => theme[status] || theme.cancelled);
    requests.data.datasets[0].borderColor = theme.surface;
  }
  const stock = charts['chart-stock'];
  if (stock) stock.data.datasets[0].backgroundColor = overview.stock.map(row =>
    row.stock_status === 'OUT' ? theme.danger : row.stock_status === 'LOW' ? theme.pending : theme.fulfilled);
  Object.values(charts).forEach(updateChartAppearance);
});

document.addEventListener('DOMContentLoaded', start);

async function start() {
  session = await bootPage('admin');
  if (!session) return;

  el('loading').style.display = 'none';
  el('content').style.display = '';

  await renderAll();

  el('btn-export').addEventListener('click', async () => {
    await downloadDatabaseFile();
    toast('Backup downloaded as <b>lifelink.sqlite</b>.', 'success');
  });

  el('btn-reset').addEventListener('click', async () => {
    const confirmation = prompt('This permanently deletes donor accounts, requests, donations, and stock. Type RESET DATA to confirm.');
    if (confirmation !== 'RESET DATA') return;
    const result = await action('adminReset', { confirm: confirmation });
    if (!result.ok) { toast(esc(result.error), 'error'); return; }
    location.href = 'login.html';
  });

  el('requests-box').addEventListener('change', event => {
    const select = event.target.closest('select[data-id]');
    if (select) adminSetStatus(Number(select.dataset.id), select);
  });
  el('requests-box').addEventListener('click', event => {
    const button = event.target.closest('button[data-delete]');
    if (button) adminDeleteRequest(Number(button.dataset.delete));
  });
  el('donors-box').addEventListener('click', event => {
    const button = event.target.closest('button[data-id]');
    if (button) adminRemoveDonor(Number(button.dataset.id), button.dataset.name);
  });
  el('users-box').addEventListener('click', event => {
    const button = event.target.closest('button[data-id]');
    if (button) resetUserPassword(Number(button.dataset.id), button.dataset.name);
  });
  el('pending-box').addEventListener('click', event => {
    const button = event.target.closest('button[data-decision]');
    if (button) adminReview(Number(button.dataset.id), button.dataset.decision);
  });
}

async function renderAll() {
  overview = await api('adminOverview');
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
  const s = overview.stats;

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
  const low = overview.stock.filter(r => r.stock_status !== 'OK');
  el('alert-slot').innerHTML = low.length
    ? `<div class="alert alert-danger">⚠️ <span>
         <b>Low stock warning:</b>&nbsp; ${low.map(r =>
           `<span class="badge badge-group">${esc(r.blood_group)}</span> ${r.units} unit${r.units === 1 ? '' : 's'} (${esc(r.stock_status === 'OUT' ? 'out of stock' : 'below threshold')})`).join(' &nbsp; ')}
       </span></div>`
    : `<div class="alert alert-info">✅ <span>All blood groups are above their low-stock threshold.</span></div>`;
}

/* ---------- critical requests (VIEW) ---------- */

function renderCritical() {
  const rows = overview.critical;
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
  const rows = overview.requests;

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
                      data-id="${r.request_id}">
                ${['pending','matched','fulfilled','cancelled'].map(s =>
                  `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
            <td><button class="btn btn-danger btn-sm" data-delete="${r.request_id}">Delete</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`
    : emptyState('🗂️', 'No requests in the system yet', 'Requests made through the Find Donor page will appear here.');
}

async function adminSetStatus(requestId, selectEl) {
  const res = await action('adminSetStatus', { id: requestId, status: selectEl.value });
  if (!res.ok) {
    toast('⚠️ ' + esc(res.error), 'error');
    renderRequestsTable();          // resets the dropdown to the DB value
    return;
  }
  if (res.note) toast('✅ ' + esc(res.note), 'success');
  else toast(`Request #${requestId} → <b>${esc(selectEl.value)}</b>`, 'success');
  renderAll();
}

async function adminRemoveDonor(userId, name) {
  if (!confirm(`Delete donor "${name}" permanently? Their profile, donation history and login are removed.`)) return;
  const res = await action('adminDeleteDonor', { id: userId });
  if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
  toast(`Donor <b>${esc(name)}</b> deleted.`, 'success');
  renderAll();
}

async function adminDeleteRequest(requestId) {
  if (!confirm(`Delete request #${requestId} permanently?`)) return;
  const res = await action('adminDeleteRequest', { id: requestId });
  if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
  toast(`Request #${requestId} deleted.`, 'success');
  renderAll();
}

/* ---------- donors & users ---------- */

function renderDonorsTable() {
  const rows = overview.donors;
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
            <td><button class="btn btn-danger btn-sm" data-id="${d.user_id}" data-name="${esc(d.full_name)}">Delete</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`
    : emptyState('🧑‍🤝‍🧑', 'No donors registered yet', 'Donor registrations will appear here.');
}

function renderUsersTable() {
  const rows = overview.users;
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
              `<button class="btn btn-ghost btn-sm" data-id="${u.user_id}" data-name="${esc(u.full_name)}">🔑 Reset password</button>`}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function resetUserPassword(userId, name) {
  const pw = prompt(`Set a new password for ${name} (12 to 128 characters):`);
  if (pw === null) return;
  const res = await action('adminResetPassword', { id: userId, password: pw });
  if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
  toast(`Password updated for <b>${esc(name)}</b>.`, 'success');
}

/* ---------- compatibility matrix ---------- */

function renderCompatTable() {
  /* recipient (rows) x donor (columns) grid built from the CompatibilityRule table */
  const rules = overview.rules;
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
  const theme = chartTheme();

  /* donors by group — two GROUP BY datasets from the summary VIEW */
  const dg = overview.donorGroups;
  const donorLabels = BLOOD_GROUPS.filter(g => dg.some(r => r.blood_group === g));
  const dgMap = Object.fromEntries(dg.map(r => [r.blood_group, r]));
  makeChart('chart-donors', 'bar', donorLabels, [
    { label: 'Total',     data: donorLabels.map(g => dgMap[g].total_donors),     backgroundColor: theme.secondary },
    { label: 'Available', data: donorLabels.map(g => dgMap[g].available_donors), backgroundColor: theme.accent }
  ]);

  /* requests by status — GROUP BY, total shown in the doughnut centre */
  const rs = overview.requestCounts;
  const totalRequests = rs.reduce((a, r) => a + r.cnt, 0);
  makeChart('chart-status', 'doughnut', rs.map(r => r.status), [
    { data: rs.map(r => r.cnt), backgroundColor: rs.map(r => theme[r.status] || theme.cancelled), borderColor: theme.surface, borderWidth: 3 }
  ], { doughnutCenter: { value: totalRequests } });

  /* stock — colour per low-stock status from the VIEW */
  const st = overview.stock;
  const barColors = st.map(r =>
    r.stock_status === 'OUT' ? theme.danger : r.stock_status === 'LOW' ? theme.pending : theme.fulfilled);
  makeChart('chart-stock', 'bar', st.map(r => r.blood_group), [
    { label: 'Units', data: st.map(r => r.units), backgroundColor: barColors }
  ]);
}

function makeChart(canvasId, type, labels, datasets, extra = {}) {
  const theme = chartTheme();
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
      color: theme.text,
      plugins: {
        legend: { position: type === 'doughnut' ? 'right' : 'bottom', labels: { color: theme.text } },
        ...extra
      },
      scales: type === 'doughnut' ? {} : {
        x: { grid: { display: false }, ticks: { color: theme.text }, border: { color: theme.grid } },
        y: { beginAtZero: true, ticks: { precision: 0, color: theme.text }, grid: { color: theme.grid }, border: { color: theme.grid } }
      }
    }
  });
}

/* ---------- donation approval + audit log (v6) ---------- */
function renderPendingDonations() {
  const rows = overview.pending;
  el('pending-box').innerHTML = rows.length ? `
    <table class="table">
      <thead><tr><th>#</th><th>Donor</th><th>Group</th><th>Units</th><th>Recorded</th><th></th></tr></thead>
      <tbody>${rows.map(d => `
        <tr><td class="num">${d.donation_id}</td><td><b>${esc(d.full_name)}</b></td>
            <td><span class="badge badge-group">${esc(d.blood_group)}</span></td><td class="num">${d.units}</td>
            <td style="white-space:nowrap">${fmtDateTime(d.donation_date)}</td>
            <td style="white-space:nowrap"><button class="btn btn-primary btn-sm" data-id="${d.donation_id}" data-decision="approved">Approve</button>
              <button class="btn btn-danger btn-sm" data-id="${d.donation_id}" data-decision="rejected">Reject</button></td></tr>`).join('')}
      </tbody></table>`
    : emptyState('✅', 'No donations waiting', 'New donations appear here for your approval.');
}
async function adminReview(id, decision) {
  const res = await action('adminReview', { id, decision });
  if (!res.ok) { toast('⚠️ ' + esc(res.error), 'error'); return; }
  toast(decision === 'approved' ? 'Donation approved — stock updated by the trigger.' : 'Donation rejected.', 'success');
  renderAll();
}
function renderAudit() {
  const rows = overview.audit;
  el('audit-box').innerHTML = rows.length ? `
    <table class="table">
      <thead><tr><th>When</th><th>Table</th><th>Record</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td style="white-space:nowrap">${fmtDateTime(r.logged_at)}</td><td>${esc(r.table_name)}</td>
        <td class="num">${r.record_id}</td><td>${esc(r.action)}</td><td>${esc(r.old_value)}</td><td><b>${esc(r.new_value)}</b></td></tr>`).join('')}</tbody></table>`
    : emptyState('🧾', 'No changes logged yet', 'Stock and request-status changes are recorded here automatically.');
}
