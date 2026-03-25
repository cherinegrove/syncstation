// src/services/emailService.js
const axios = require('axios');

const FROM     = process.env.RESEND_FROM_EMAIL || 'PropBridge <onboarding@resend.dev>';
const BASE_URL = process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] No RESEND_API_KEY — skipping:', subject);
    return false;
  }
  if (!to) {
    console.log('[Email] No recipient — skipping:', subject);
    return false;
  }
  try {
    await axios.post('https://api.resend.com/emails', {
      from: FROM, to, subject, html
    }, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
    });
    console.log(`[Email] Sent "${subject}" to ${to}`);
    return true;
  } catch (err) {
    console.error('[Email] Send error:', err.response?.data || err.message);
    return false;
  }
}

function bodyToHtml(body) {
  return body
    .split('\n')
    .map(line => line.trim() === '' ? '<br>' : `<p style="margin:8px 0;font-size:15px;line-height:1.6;color:#c0c0d0">${line}</p>`)
    .join('');
}

function wrapTemplate(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0f11;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#18181c;border-radius:12px;overflow:hidden;border:1px solid #2e2e38">
    <div style="background:linear-gradient(135deg,#ff6b35,#ffb347);padding:24px 32px;display:flex;align-items:center">
      <span style="color:white;font-size:22px;font-weight:700;letter-spacing:-0.5px">⇄ PropBridge</span>
    </div>
    <div style="padding:32px;color:#f0f0f4">${content}</div>
    <div style="padding:16px 32px;border-top:1px solid #2e2e38;text-align:center">
      <p style="color:#8888a0;font-size:12px;margin:0">PropBridge — HubSpot Property Sync</p>
    </div>
  </div>
</body>
</html>`;
}

function btn(label, url) {
  return `<a href="${url}" style="display:inline-block;background:#ff6b35;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:16px">${label}</a>`;
}

function infoBox(rows) {
  return `<table style="width:100%;border-collapse:collapse;background:#222228;border-radius:8px;overflow:hidden;margin:16px 0">
    ${rows.map(([l, v]) => `<tr><td style="padding:8px 12px;color:#8888a0;font-size:13px">${l}</td><td style="padding:8px 12px;color:#f0f0f4;font-size:13px;font-family:monospace">${v}</td></tr>`).join('')}
  </table>`;
}

// Send email using a rule template from DB
async function sendRuleEmail(ruleId, to, portalId, extraVars = {}) {
  try {
    const { getRule, logEmail } = require('./emailRulesService');
    const rule = await getRule(ruleId);

    if (!rule) {
      console.log(`[Email] Rule ${ruleId} not found`);
      return false;
    }

    if (!rule.enabled) {
      console.log(`[Email] Rule ${ruleId} is disabled — skipping`);
      return false;
    }

    // Replace variables in subject and body
    let subject = rule.subject;
    let body    = rule.body;

    const vars = {
      portalId: portalId || '',
      settingsUrl: `${BASE_URL}/settings?portalId=${portalId}`,
      accountUrl:  `${BASE_URL}/account?portalId=${portalId}`,
      ...extraVars
    };

    Object.entries(vars).forEach(([key, value]) => {
      subject = subject.replace(new RegExp(`{{${key}}}`, 'g'), value);
      body    = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });

    const html = wrapTemplate(bodyToHtml(body) + btn('Open PropBridge', vars.settingsUrl));
    const sent = await sendEmail(to, subject, html);
    await logEmail(portalId, ruleId, to, subject, sent ? 'sent' : 'failed');
    return sent;
  } catch (err) {
    console.error(`[Email] sendRuleEmail error for ${ruleId}:`, err.message);
    return false;
  }
}

// Direct send functions (used by account/oauth routes)
async function sendTrialActivated(to, portalId) {
  return sendRuleEmail('trial_activated', to, portalId);
}

async function sendTrialEnding(to, portalId, daysLeft) {
  const ruleId = daysLeft <= 3 ? 'trial_ending_3' : 'trial_ending_7';
  return sendRuleEmail(ruleId, to, portalId, { daysLeft: String(daysLeft) });
}

async function sendTrialExpired(to, portalId) {
  return sendRuleEmail('trial_expired', to, portalId);
}

async function sendPlanChanged(to, portalId, fromTier, toTier, tierInfo) {
  const isUpgrade = tierInfo.price > 0;
  const ruleId    = isUpgrade ? 'plan_upgraded' : 'plan_changed';
  return sendRuleEmail(ruleId, to, portalId, {
    fromTier,
    toTier,
    planName:    tierInfo.name,
    planPrice:   `$${tierInfo.price}/month`,
    maxRules:    String(tierInfo.maxRules),
    maxMappings: String(tierInfo.maxMappings)
  });
}

async function sendAdminNotification(subject, message) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  const html = wrapTemplate(`<h2 style="color:#f0f0f4;margin:0 0 16px">Admin Alert</h2><p style="color:#c0c0d0">${message}</p>`);
  return sendEmail(adminEmail, `[PropBridge Admin] ${subject}`, html);
}

module.exports = {
  sendEmail,
  sendRuleEmail,
  sendTrialActivated,
  sendTrialEnding,
  sendTrialExpired,
  sendPlanChanged,
  sendAdminNotification,
  wrapTemplate,
  bodyToHtml,
  btn
};
