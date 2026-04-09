<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PropBridge Admin</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0f0f11; --surface: #18181c; --surface2: #222228;
    --border: #2e2e38; --accent: #ff6b35; --text: #f0f0f4;
    --muted: #8888a0; --success: #4ade80; --warning: #fbbf24; --error: #f87171;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

  .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 40px; height: 64px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
  .logo { font-family: 'DM Mono', monospace; font-size: 18px; display: flex; align-items: center; gap: 10px; }
  .logo-icon { width: 32px; height: 32px; background: linear-gradient(135deg, var(--accent), #ffb347); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
  .admin-badge { background: var(--accent); color: white; font-size: 11px; padding: 2px 8px; border-radius: 4px; }

  .tabs { display: flex; gap: 4px; padding: 0 40px; background: var(--surface); border-bottom: 1px solid var(--border); overflow-x: auto; }
  .tab { padding: 14px 20px; cursor: pointer; font-size: 14px; color: var(--muted); border-bottom: 2px solid transparent; transition: all 0.15s; white-space: nowrap; }
  .tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .tab:hover { color: var(--text); }

  .main { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }
  .panel { display: none; }
  .panel.active { display: block; }

  .stats-bar { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 28px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px; }
  .stat-value { font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 500; color: var(--accent); line-height: 1; margin-bottom: 4px; }
  .stat-label { font-size: 12px; color: var(--muted); }

  table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 10px; overflow: hidden; border: 1px solid var(--border); margin-bottom: 24px; }
  th { text-align: left; padding: 12px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); border-bottom: 1px solid var(--border); }
  td { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 14px; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface2); }

  .tier-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-family: 'DM Mono', monospace; }
  .tier-trial     { background: rgba(251,191,36,0.15); color: var(--warning); border: 1px solid rgba(251,191,36,0.3); }
  .tier-starter   { background: rgba(74,222,128,0.1); color: var(--success); border: 1px solid rgba(74,222,128,0.3); }
  .tier-growth    { background: rgba(96,165,250,0.1); color: #60a5fa; border: 1px solid rgba(96,165,250,0.3); }
  .tier-pro       { background: rgba(167,139,250,0.1); color: #a78bfa; border: 1px solid rgba(167,139,250,0.3); }
  .tier-business  { background: rgba(255,107,53,0.1); color: var(--accent); border: 1px solid rgba(255,107,53,0.3); }
  .tier-cancelled { background: rgba(139,139,139,0.1); color: #888; border: 1px solid rgba(139,139,139,0.3); }
  .tier-suspended { background: rgba(248,113,113,0.1); color: var(--error); border: 1px solid rgba(248,113,113,0.3); }
  .tier-expired   { background: rgba(248,113,113,0.1); color: var(--error); border: 1px solid rgba(248,113,113,0.3); }

  .notif-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; }
  .notif-info    { background: rgba(96,165,250,0.1); color: #60a5fa; }
  .notif-warning { background: rgba(251,191,36,0.15); color: var(--warning); }
  .notif-error   { background: rgba(248,113,113,0.1); color: var(--error); }
  .notif-success { background: rgba(74,222,128,0.1); color: var(--success); }

  select, input, textarea {
    background: var(--surface2); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 8px 12px; width: 100%;
  }
  textarea { font-family: 'DM Mono', monospace; font-size: 13px; line-height: 1.6; resize: vertical; }
  select:focus, input:focus, textarea:focus { outline: none; border-color: var(--accent); }

  .btn { padding: 8px 16px; border-radius: 8px; border: none; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover { background: #ff8555; }
  .btn-secondary { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }
  .btn-secondary:hover { color: var(--text); }
  .btn-success { background: rgba(74,222,128,0.15); color: var(--success); border: 1px solid rgba(74,222,128,0.3); }
  .btn-sm { padding: 5px 12px; font-size: 13px; }
  .btn-danger { background: rgba(248,113,113,0.15); color: var(--error); border: 1px solid rgba(248,113,113,0.3); }

  .form-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 24px; margin-bottom: 24px; }
  .form-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
  .form-card .subtitle { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group.full { grid-column: 1 / -1; }
  .form-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }

  .email-rule-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
  .email-rule-header { display: flex; align-items: center; padding: 16px 20px; gap: 14px; cursor: pointer; }
  .email-rule-header:hover { background: var(--surface2); }
  .rule-toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
  .rule-toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-slider { position: absolute; inset: 0; background: var(--surface2); border-radius: 22px; border: 1px solid var(--border); cursor: pointer; transition: 0.2s; }
  .toggle-slider:before { content: ''; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; background: var(--muted); border-radius: 50%; transition: 0.2s; }
  input:checked + .toggle-slider { background: var(--accent); border-color: var(--accent); }
  input:checked + .toggle-slider:before { transform: translateX(18px); background: white; }
  .rule-body { padding: 0 20px 20px; border-top: 1px solid var(--border); display: none; }
  .rule-body.open { display: block; padding-top: 16px; }

  .mono { font-family: 'DM Mono', monospace; font-size: 12px; color: var(--muted); }
  .countdown-pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-family: 'DM Mono', monospace; font-size: 11px; }
  .countdown-ok      { background: rgba(74,222,128,0.1); color: var(--success); }
  .countdown-warning { background: rgba(251,191,36,0.15); color: var(--warning); }
  .countdown-danger  { background: rgba(248,113,113,0.1); color: var(--error); }

  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--success); border-radius: 8px; padding: 12px 18px; font-size: 14px; transform: translateY(80px); opacity: 0; transition: all 0.3s; z-index: 300; }
  .toast.show { transform: translateY(0); opacity: 1; }
  .actions-row { display: flex; gap: 10px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }

  .var-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .var-chip { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-family: 'DM Mono', monospace; font-size: 12px; color: var(--accent); cursor: pointer; }
  .var-chip:hover { border-color: var(--accent); }
</style>
</head>
<body>

<div class="header">
  <div class="logo"><div class="logo-icon">⇄</div> PropBridge <span class="admin-badge">ADMIN</span></div>
  <span class="mono" id="lastUpdated"></span>
</div>

<div class="tabs">
  <div class="tab active" onclick="showPanel('portals', this)">Portals</div>
  <div class="tab" onclick="showPanel('messages', this)">Message Center</div>
  <div class="tab" onclick="showPanel('emails', this)">Email Notifications</div>
  <div class="tab" onclick="showPanel('emaillog', this)">Email Log</div>
  <div class="tab" onclick="showPanel('history', this)">Notification History</div>
</div>

<div class="main">

  <!-- PORTALS PANEL -->
  <div class="panel active" id="panel-portals">
    <div class="stats-bar">
      <div class="stat-card"><div class="stat-value" id="statTotal">0</div><div class="stat-label">Total portals</div></div>
      <div class="stat-card"><div class="stat-value" id="statTrial">0</div><div class="stat-label">On trial</div></div>
      <div class="stat-card"><div class="stat-value" id="statPaid">0</div><div class="stat-label">Paid</div></div>
      <div class="stat-card"><div class="stat-value" id="statExpired">0</div><div class="stat-label">Expired</div></div>
      <div class="stat-card"><div class="stat-value" id="statMRR">$0</div><div class="stat-label">Est. MRR</div></div>
    </div>
    <div class="actions-row">
      <button class="btn btn-secondary btn-sm" onclick="runChecks()">▶ Run Automated Checks</button>
      <span class="mono" id="checksStatus"></span>
    </div>
    <table>
      <thead>
        <tr><th>Portal ID</th><th>Tier</th><th>Started</th><th>Expires</th><th>Status</th><th>Change Tier</th><th>Actions</th></tr>
      </thead>
      <tbody id="portalTable">
        <tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">Loading...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- MESSAGE CENTER PANEL -->
  <div class="panel" id="panel-messages">
    <div class="form-card">
      <h3>📣 Send In-App Notification</h3>
      <div class="subtitle">Sends a banner notification inside PropBridge for the selected portals.</div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Send To</label>
          <select id="msgTarget" onchange="toggleSpecificPortal()">
            <option value="all">All Portals</option>
            <option value="specific">Specific Portal ID</option>
          </select>
        </div>
        <div class="form-group" id="specificPortalGroup" style="display:none">
          <label class="form-label">Portal ID</label>
          <input type="text" id="msgPortalId" placeholder="24888076">
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select id="msgType">
            <option value="info">ℹ Info</option>
            <option value="warning">⚠ Warning</option>
            <option value="error">🔴 Error</option>
            <option value="success">✅ Success</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Title</label>
          <input type="text" id="msgTitle" placeholder="New feature available!">
        </div>
        <div class="form-group full">
          <label class="form-label">Message</label>
          <textarea id="msgBody" rows="3" placeholder="Your message here..."></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Action Button Label (optional)</label>
          <input type="text" id="msgActionLabel" placeholder="Learn More">
        </div>
        <div class="form-group">
          <label class="form-label">Action URL (optional)</label>
          <input type="text" id="msgActionUrl" placeholder="/account?portalId=...">
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" onclick="sendMessage()">Send Notification</button>
        <span class="mono" id="msgStatus"></span>
      </div>
    </div>
    <div class="form-card">
      <h3>⚡ Quick Messages</h3>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        <button class="btn btn-secondary btn-sm" onclick="quickMsg('trial_expiring')">Trial Expiring</button>
        <button class="btn btn-secondary btn-sm" onclick="quickMsg('usage_90')">Usage at 90%</button>
        <button class="btn btn-secondary btn-sm" onclick="quickMsg('new_feature')">New Feature</button>
        <button class="btn btn-secondary btn-sm" onclick="quickMsg('maintenance')">Maintenance</button>
      </div>
    </div>
  </div>

  <!-- EMAIL NOTIFICATIONS PANEL -->
  <div class="panel" id="panel-emails">
    <div class="form-card" style="margin-bottom:24px">
      <h3>📧 Email Notification Rules</h3>
      <div class="subtitle">Manage automated email notifications sent to your customers. Toggle rules on/off and customise the subject and message for each trigger.</div>
      <div style="margin-top:12px;padding:12px 16px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">
        <p style="font-size:13px;color:var(--muted)">Available variables you can use in subject and body:</p>
        <div class="var-chips" style="margin-top:8px">
          <span class="var-chip" onclick="copyVar('{{portalId}}')">{{portalId}}</span>
          <span class="var-chip" onclick="copyVar('{{planName}}')">{{planName}}</span>
          <span class="var-chip" onclick="copyVar('{{planPrice}}')">{{planPrice}}</span>
          <span class="var-chip" onclick="copyVar('{{maxRules}}')">{{maxRules}}</span>
          <span class="var-chip" onclick="copyVar('{{maxMappings}}')">{{maxMappings}}</span>
          <span class="var-chip" onclick="copyVar('{{daysLeft}}')">{{daysLeft}}</span>
          <span class="var-chip" onclick="copyVar('{{fromTier}}')">{{fromTier}}</span>
          <span class="var-chip" onclick="copyVar('{{toTier}}')">{{toTier}}</span>
          <span class="var-chip" onclick="copyVar('{{settingsUrl}}')">{{settingsUrl}}</span>
          <span class="var-chip" onclick="copyVar('{{accountUrl}}')">{{accountUrl}}</span>
        </div>
      </div>
    </div>
    <div id="emailRulesList">
      <div style="text-align:center;color:var(--muted);padding:40px">Loading email rules...</div>
    </div>
  </div>

  <!-- EMAIL LOG PANEL -->
  <div class="panel" id="panel-emaillog">
    <div class="actions-row">
      <button class="btn btn-secondary btn-sm" onclick="loadEmailLog()">↻ Refresh</button>
    </div>
    <table>
      <thead>
        <tr><th>Portal</th><th>Rule</th><th>Sent To</th><th>Subject</th><th>Status</th><th>Sent At</th></tr>
      </thead>
      <tbody id="emailLogTable">
        <tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">Loading...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- NOTIFICATION HISTORY PANEL -->
  <div class="panel" id="panel-history">
    <div class="actions-row">
      <button class="btn btn-secondary btn-sm" onclick="loadHistory()">↻ Refresh</button>
    </div>
    <table>
      <thead>
        <tr><th>Portal</th><th>Type</th><th>Title</th><th>Message</th><th>Status</th><th>Sent</th></tr>
      </thead>
      <tbody id="historyTable">
        <tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">Loading...</td></tr>
      </tbody>
    </table>
  </div>

</div>

<div class="toast" id="toast"></div>

<script>
  const TIER_PRICES = { trial: 0, starter: 7, growth: 12, pro: 16, business: 25, cancelled: 0, suspended: 0 };
  const adminKey    = new URLSearchParams(window.location.search).get('key') || '';

  function showPanel(name, el) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('panel-' + name).classList.add('active');
    el.classList.add('active');
    if (name === 'history') loadHistory();
    if (name === 'emails') loadEmailRules();
    if (name === 'emaillog') loadEmailLog();
  }

  function toggleSpecificPortal() {
    document.getElementById('specificPortalGroup').style.display =
      document.getElementById('msgTarget').value === 'specific' ? 'flex' : 'none';
  }

  async function apiFetch(url, options = {}) {
    const sep = url.includes('?') ? '&' : '?';
    return fetch(url + (adminKey ? sep + 'key=' + adminKey : ''), options);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getTrialCountdown(trialStartedAt, tier) {
    if (tier !== 'trial') return null;
    const expiry   = new Date(trialStartedAt).getTime() + (14 * 86400000);
    const daysLeft = Math.ceil((expiry - Date.now()) / 86400000);
    return { daysLeft, expiry, isExpired: daysLeft <= 0 };
  }

  // ── PORTALS ──────────────────────────────────────────────

  async function loadPortals() {
    const res     = await apiFetch('/admin/portals');
    const data    = await res.json();
    const portals = data.portals || [];
    let trial = 0, paid = 0, expired = 0, mrr = 0;

    portals.forEach(p => {
      if (p.tier === 'trial') {
        const c = getTrialCountdown(p.created_at, p.tier);
        if (c?.isExpired) expired++; else trial++;
      } else if (!['cancelled','suspended'].includes(p.tier)) {
        paid++; mrr += TIER_PRICES[p.tier] || 0;
      }
    });

    document.getElementById('statTotal').textContent   = portals.length;
    document.getElementById('statTrial').textContent   = trial;
    document.getElementById('statPaid').textContent    = paid;
    document.getElementById('statExpired').textContent = expired;
    document.getElementById('statMRR').textContent     = '$' + mrr;
    document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();

    const tbody = document.getElementById('portalTable');
    if (!portals.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">No portals yet</td></tr>';
      return;
    }

    tbody.innerHTML = portals.map(p => {
      const c         = getTrialCountdown(p.created_at, p.tier);
      const isExpired = c?.isExpired;
      const tierClass = isExpired ? 'expired' : p.tier;
      const tierLabel = isExpired ? 'Trial Expired' : p.tier.charAt(0).toUpperCase() + p.tier.slice(1);
      const expiry    = p.tier === 'trial' ? formatDate(new Date(c?.expiry)) : '—';
      let statusHtml  = '—';

      if (p.tier === 'trial' && c) {
        const cls = c.isExpired ? 'danger' : c.daysLeft <= 3 ? 'danger' : c.daysLeft <= 7 ? 'warning' : 'ok';
        statusHtml = `<span class="countdown-pill countdown-${cls}">${c.isExpired ? 'Expired' : c.daysLeft + 'd left'}</span>`;
      } else if (!['trial','cancelled','suspended'].includes(p.tier)) {
        statusHtml = `<span class="countdown-pill countdown-ok">Active</span>`;
      }

      return `<tr>
        <td>
          <span class="mono">${p.portal_id}</span><br>
          <a href="/settings?portalId=${p.portal_id}" target="_blank" style="color:var(--accent);font-size:11px;text-decoration:none">Settings ↗</a>
        </td>
        <td><span class="tier-badge tier-${tierClass}">${tierLabel}</span></td>
        <td><span class="mono">${formatDate(p.created_at)}</span></td>
        <td><span class="mono">${expiry}</span></td>
        <td>${statusHtml}</td>
        <td>
          <select id="tier-${p.portal_id}" style="width:155px">
            <option value="trial"     ${p.tier==='trial'?'selected':''}>Trial</option>
            <option value="starter"   ${p.tier==='starter'?'selected':''}>Starter ($7)</option>
            <option value="growth"    ${p.tier==='growth'?'selected':''}>Growth ($12)</option>
            <option value="pro"       ${p.tier==='pro'?'selected':''}>Pro ($16)</option>
            <option value="business"  ${p.tier==='business'?'selected':''}>Business ($25)</option>
            <option value="suspended" ${p.tier==='suspended'?'selected':''}>🚫 Suspended</option>
            <option value="cancelled" ${p.tier==='cancelled'?'selected':''}>❌ Cancelled</option>
          </select>
        </td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="saveTier('${p.portal_id}')">Save</button>
          <button class="btn btn-secondary btn-sm" onclick="msgPortal('${p.portal_id}')">✉ Message</button>
        </td>
      </tr>`;
    }).join('');
  }

  async function saveTier(portalId) {
    const tier = document.getElementById('tier-' + portalId).value;
    await apiFetch('/admin/portals/' + portalId + '/tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier })
    });
    showToast('✓ Tier updated to ' + tier);
    loadPortals();
  }

  function msgPortal(portalId) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('panel-messages').classList.add('active');
    document.querySelectorAll('.tab')[1].classList.add('active');
    document.getElementById('msgTarget').value = 'specific';
    document.getElementById('specificPortalGroup').style.display = 'flex';
    document.getElementById('msgPortalId').value = portalId;
  }

  // ── MESSAGES ─────────────────────────────────────────────

  async function sendMessage() {
    const target      = document.getElementById('msgTarget').value;
    const type        = document.getElementById('msgType').value;
    const title       = document.getElementById('msgTitle').value.trim();
    const message     = document.getElementById('msgBody').value.trim();
    const actionLabel = document.getElementById('msgActionLabel').value.trim();
    const actionUrl   = document.getElementById('msgActionUrl').value.trim();
    if (!title || !message) { showToast('Please fill in title and message'); return; }
    const body = { type, title, message, actionLabel, actionUrl };
    if (target === 'specific') body.portalId = document.getElementById('msgPortalId').value.trim();
    else body.all = true;
    const res  = await apiFetch('/admin/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    document.getElementById('msgStatus').textContent = `✓ Sent to ${data.sent} portal(s)`;
    showToast('✓ Notification sent!');
    document.getElementById('msgTitle').value = '';
    document.getElementById('msgBody').value  = '';
  }

  function quickMsg(type) {
    const msgs = {
      trial_expiring: { title: 'Your free trial is ending soon', message: 'Upgrade now to keep your sync rules active.', type: 'warning', actionLabel: 'View Plans', actionUrl: '/account' },
      usage_90: { title: "You've used 90% of your sync rules", message: 'Upgrade to add more rules.', type: 'warning', actionLabel: 'Upgrade', actionUrl: '/account' },
      new_feature: { title: '🎉 New Feature Available', message: 'We\'ve added new functionality to PropBridge!', type: 'info' },
      maintenance: { title: '🔧 Scheduled Maintenance', message: 'PropBridge will be briefly unavailable for maintenance.', type: 'warning' }
    };
    const m = msgs[type];
    document.getElementById('msgTitle').value = m.title;
    document.getElementById('msgBody').value  = m.message;
    document.getElementById('msgType').value  = m.type;
  }

  // ── EMAIL RULES ───────────────────────────────────────────

  async function loadEmailRules() {
    const res   = await apiFetch('/admin/email-rules');
    const data  = await res.json();
    const rules = data.rules || [];
    const container = document.getElementById('emailRulesList');

    if (!rules.length) {
      container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px">No email rules found</div>';
      return;
    }

    container.innerHTML = rules.map(rule => `
      <div class="email-rule-card" id="rule-card-${rule.id}">
        <div class="email-rule-header" onclick="toggleRuleBody('${rule.id}')">
          <label class="rule-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="toggleRule('${rule.id}', this.checked)">
            <span class="toggle-slider"></span>
          </label>
          <div style="flex:1">
            <div style="font-weight:500;font-size:15px">${rule.name}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px;font-family:monospace">${rule.subject}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();testEmail('${rule.id}')">✉ Test</button>
            <span style="color:var(--muted);font-size:18px">›</span>
          </div>
        </div>
        <div class="rule-body" id="rule-body-${rule.id}">
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label">Subject Line</label>
            <input type="text" id="subject-${rule.id}" value="${escHtml(rule.subject)}">
          </div>
          <div class="form-group" style="margin-bottom:16px">
            <label class="form-label">Email Body</label>
            <textarea id="body-${rule.id}" rows="8">${escHtml(rule.body)}</textarea>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-primary btn-sm" onclick="saveRule('${rule.id}', '${escHtml(rule.name)}')">Save Changes</button>
            <button class="btn btn-secondary btn-sm" onclick="resetRule('${rule.id}')">Reset to Default</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function toggleRuleBody(id) {
    const body = document.getElementById('rule-body-' + id);
    body.classList.toggle('open');
  }

  async function toggleRule(id, enabled) {
    const subjectEl = document.getElementById('subject-' + id);
    const bodyEl    = document.getElementById('body-' + id);
    const subject   = subjectEl ? subjectEl.value : '';
    const body      = bodyEl ? bodyEl.value : '';
    await apiFetch('/admin/email-rules/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, subject, body })
    });
    showToast(enabled ? '✓ Email rule enabled' : 'Email rule disabled');
  }

  async function saveRule(id, name) {
    const subject = document.getElementById('subject-' + id).value.trim();
    const body    = document.getElementById('body-' + id).value.trim();
    const enabled = document.querySelector(`#rule-card-${id} input[type=checkbox]`).checked;
    await apiFetch('/admin/email-rules/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body, enabled, name })
    });
    showToast('✓ Email rule saved');
  }

  async function testEmail(id) {
    const email = prompt('Send test email to:');
    if (!email) return;
    const res  = await apiFetch('/admin/email-rules/' + id + '/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    showToast(data.ok ? '✓ Test email sent!' : '✗ Failed: ' + data.error);
  }

  async function resetRule(id) {
    if (!confirm('Reset this rule to default content?')) return;
    await apiFetch('/admin/email-rules/' + id + '/reset', { method: 'POST' });
    showToast('✓ Rule reset to default');
    loadEmailRules();
  }

  function copyVar(text) {
    navigator.clipboard.writeText(text);
    showToast('Copied ' + text);
  }

  // ── EMAIL LOG ─────────────────────────────────────────────

  async function loadEmailLog() {
    const res  = await apiFetch('/admin/email-log');
    const data = await res.json();
    const logs = data.logs || [];
    const tbody = document.getElementById('emailLogTable');
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">No emails sent yet</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => `<tr>
      <td><span class="mono">${l.portal_id || '—'}</span></td>
      <td><span class="mono">${l.rule_id || '—'}</span></td>
      <td><span class="mono">${l.to_email || '—'}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.subject}</td>
      <td><span class="notif-badge ${l.status === 'sent' ? 'notif-success' : 'notif-error'}">${l.status}</span></td>
      <td><span class="mono">${new Date(l.created_at).toLocaleString()}</span></td>
    </tr>`).join('');
  }

  // ── NOTIFICATION HISTORY ──────────────────────────────────

  async function loadHistory() {
    const res  = await apiFetch('/admin/notifications');
    const data = await res.json();
    const notifications = data.notifications || [];
    const tbody = document.getElementById('historyTable');
    if (!notifications.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">No notifications yet</td></tr>';
      return;
    }
    tbody.innerHTML = notifications.map(n => `<tr>
      <td><span class="mono">${n.portal_id}</span></td>
      <td><span class="notif-badge notif-${n.type}">${n.type}</span></td>
      <td>${n.title}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">${n.message}</td>
      <td><span class="mono">${n.status}</span></td>
      <td><span class="mono">${new Date(n.created_at).toLocaleString()}</span></td>
    </tr>`).join('');
  }

  // ── UTILITIES ─────────────────────────────────────────────

  async function runChecks() {
    document.getElementById('checksStatus').textContent = 'Running...';
    await apiFetch('/admin/run-checks', { method: 'POST' });
    document.getElementById('checksStatus').textContent = '✓ Done';
    showToast('✓ Automated checks complete');
    loadPortals();
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  function escHtml(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  loadPortals();
  setInterval(loadPortals, 30000);
</script>
</body>
</html>
