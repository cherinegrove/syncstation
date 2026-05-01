// src/routes/adminChatbot.js
// Technical Product Specialist — admin-only AI assistant
// Has full access to all portal data, logs, tiers, and user info

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');

let pool = null;
function getPool() {
    if (!pool && process.env.DATABASE_URL) {
        pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    }
    return pool;
}

// ── REQUIRE ADMIN SESSION ─────────────────────────────────────────────────────

function requireAdminSession(req, res, next) {
    if (req.session && req.session.adminUser) return next();
    return res.status(401).json({ error: 'Admin authentication required' });
}

// ── POST /admin/api/assistant/message ────────────────────────────────────────

router.post('/message', requireAdminSession, async (req, res) => {
    const { message, history = [] } = req.body;

    if (!message) return res.status(400).json({ error: 'Message required' });
    if (!process.env.CLAUDE_API_KEY) return res.status(500).json({ error: 'CLAUDE_API_KEY not configured' });

    const p = getPool();
    let dataContext = '';

    try {
        // ── PULL RELEVANT DATA BASED ON MESSAGE CONTENT ───────────────────────

        // 1. Always pull platform summary
        const summary = await p.query(`
            SELECT
                COUNT(DISTINCT pt.portal_id)                          AS total_portals,
                COUNT(DISTINCT pt.portal_id) FILTER (WHERE pt.tier = 'trial')    AS trial_portals,
                COUNT(DISTINCT pt.portal_id) FILTER (WHERE pt.tier = 'starter')  AS starter_portals,
                COUNT(DISTINCT pt.portal_id) FILTER (WHERE pt.tier = 'pro')      AS pro_portals,
                COUNT(DISTINCT pt.portal_id) FILTER (WHERE pt.tier = 'business') AS business_portals,
                COUNT(DISTINCT sl.portal_id) FILTER (WHERE sl.sync_time > NOW() - INTERVAL '24 hours') AS active_today,
                COUNT(*) FILTER (WHERE sl.status = 'error' AND sl.sync_time > NOW() - INTERVAL '24 hours')   AS errors_24h,
                COUNT(*) FILTER (WHERE sl.status = 'success' AND sl.sync_time > NOW() - INTERVAL '24 hours') AS success_24h
            FROM portal_tiers pt
            LEFT JOIN sync_logs sl ON sl.portal_id = pt.portal_id
        `).catch(() => ({ rows: [{}] }));

        const s = summary.rows[0] || {};
        dataContext += `\nPLATFORM SUMMARY (live data):\n`;
        dataContext += `  Total portals: ${s.total_portals || 0} | Trial: ${s.trial_portals || 0} | Starter: ${s.starter_portals || 0} | Pro: ${s.pro_portals || 0} | Business: ${s.business_portals || 0}\n`;
        dataContext += `  Last 24h: ${s.active_today || 0} active portals | ${s.success_24h || 0} successful syncs | ${s.errors_24h || 0} errors\n`;

        // 2. If message mentions errors / issues / problems — pull recent errors
        const errorKeywords = ['error', 'issue', 'problem', 'fail', 'broken', 'not working', 'wrong', 'stuck'];
        if (errorKeywords.some(k => message.toLowerCase().includes(k))) {
            const errors = await p.query(`
                SELECT sl.portal_id, sl.sync_time, sl.error_message, sl.object_type, sl.rule_name,
                       sl.source_record_id, sl.target_record_id, pt.tier
                FROM sync_logs sl
                LEFT JOIN portal_tiers pt ON pt.portal_id = sl.portal_id
                WHERE sl.status = 'error'
                  AND sl.sync_time > NOW() - INTERVAL '48 hours'
                ORDER BY sl.sync_time DESC
                LIMIT 30
            `).catch(() => ({ rows: [] }));

            if (errors.rows.length > 0) {
                dataContext += `\nRECENT ERRORS (last 48h — ${errors.rows.length} errors):\n`;
                errors.rows.forEach(e => {
                    dataContext += `  [${new Date(e.sync_time).toLocaleString()}] Portal ${e.portal_id} (${e.tier || 'unknown'}) | ${e.object_type} | ${e.rule_name} | ${e.error_message}`;
                    if (e.source_record_id) dataContext += ` | src: ${e.source_record_id}`;
                    if (e.target_record_id)  dataContext += ` | tgt: ${e.target_record_id}`;
                    dataContext += '\n';
                });
            }
        }

        // 3. If message mentions a specific portal ID — pull full data for that portal
        const portalMatch = message.match(/\b(\d{7,12})\b/);
        if (portalMatch) {
            const pid = portalMatch[1];

            const [tierRes, usersRes, logsRes] = await Promise.all([
                p.query(`SELECT * FROM portal_tiers WHERE portal_id = $1`, [pid]).catch(() => ({ rows: [] })),
                p.query(`
                    SELECT u.email, u.full_name, u.last_login, pu.role
                    FROM portal_users pu JOIN users u ON u.id = pu.user_id
                    WHERE pu.portal_id = $1
                `, [pid]).catch(() => ({ rows: [] })),
                p.query(`
                    SELECT sync_time, status, error_message, object_type, rule_name,
                           COALESCE(trigger_type, 'polling') AS trigger_type,
                           source_record_id, target_record_id
                    FROM sync_logs WHERE portal_id = $1
                    ORDER BY sync_time DESC LIMIT 30
                `, [pid]).catch(() => ({ rows: [] }))
            ]);

            if (tierRes.rows.length > 0) {
                const t = tierRes.rows[0];
                dataContext += `\nPORTAL ${pid} DETAILS:\n`;
                dataContext += `  Tier: ${t.tier} | Paddle sub: ${t.paddle_subscription_id || 'none'} | Sub status: ${t.paddle_subscription_status || 'none'}\n`;
                dataContext += `  Trial started: ${t.trial_started_at ? new Date(t.trial_started_at).toLocaleDateString() : 'n/a'}\n`;
            }

            if (usersRes.rows.length > 0) {
                dataContext += `  Users: ${usersRes.rows.map(u => `${u.full_name || u.email} (${u.role})`).join(', ')}\n`;
            } else {
                // Fallback to tokens table for OAuth installer email
                const tok = await p.query(`SELECT data->>'installerEmail' AS email FROM tokens WHERE portal_id = $1`, [pid]).catch(() => ({ rows: [] }));
                if (tok.rows[0]?.email) dataContext += `  Owner (OAuth): ${tok.rows[0].email}\n`;
            }

            if (logsRes.rows.length > 0) {
                const successes = logsRes.rows.filter(l => l.status === 'success').length;
                const errors    = logsRes.rows.filter(l => l.status === 'error');
                dataContext += `  Recent activity (last 30 events): ${successes} success, ${errors.length} errors\n`;
                if (errors.length > 0) {
                    dataContext += `  Recent errors:\n`;
                    errors.slice(0, 5).forEach(e => {
                        dataContext += `    [${new Date(e.sync_time).toLocaleString()}] ${e.object_type} | ${e.rule_name} | ${e.error_message}`;
                        if (e.source_record_id) dataContext += ` | src: ${e.source_record_id}`;
                        if (e.target_record_id)  dataContext += ` | tgt: ${e.target_record_id}`;
                        dataContext += '\n';
                    });
                }
            } else {
                dataContext += `  No sync logs found for this portal.\n`;
            }
        }

        // 4. If asking about a specific record ID
        const recordMatch = message.match(/record[^\d]*(\d{10,})/i);
        if (recordMatch) {
            const rid = recordMatch[1];
            const recordLogs = await p.query(`
                SELECT portal_id, sync_time, status, error_message, object_type, rule_name,
                       source_record_id, target_record_id,
                       COALESCE(trigger_type, 'polling') AS trigger_type
                FROM sync_logs
                WHERE source_record_id = $1 OR target_record_id = $1
                ORDER BY sync_time DESC LIMIT 20
            `, [rid]).catch(() => ({ rows: [] }));

            if (recordLogs.rows.length > 0) {
                dataContext += `\nLOGS FOR RECORD ${rid}:\n`;
                recordLogs.rows.forEach(l => {
                    dataContext += `  [${new Date(l.sync_time).toLocaleString()}] Portal ${l.portal_id} | ${l.status.toUpperCase()} | ${l.object_type} | ${l.rule_name}`;
                    if (l.error_message) dataContext += ` | ERROR: ${l.error_message}`;
                    dataContext += '\n';
                });
            } else {
                dataContext += `\nNo sync logs found for record ID ${rid}.\n`;
            }
        }

        // 5. If asking about tier / upgrades / billing
        const billingKeywords = ['tier', 'plan', 'upgrade', 'billing', 'paddle', 'trial', 'expir', 'payment'];
        if (billingKeywords.some(k => message.toLowerCase().includes(k))) {
            const tiers = await p.query(`
                SELECT portal_id, tier, paddle_subscription_status, trial_started_at, updated_at
                FROM portal_tiers
                ORDER BY updated_at DESC
                LIMIT 20
            `).catch(() => ({ rows: [] }));

            if (tiers.rows.length > 0) {
                dataContext += `\nALL PORTAL TIERS:\n`;
                tiers.rows.forEach(t => {
                    const trialExp = t.trial_started_at
                        ? new Date(new Date(t.trial_started_at).getTime() + 7*86400000).toLocaleDateString()
                        : null;
                    dataContext += `  Portal ${t.portal_id}: ${t.tier.toUpperCase()}`;
                    if (t.paddle_subscription_status) dataContext += ` (${t.paddle_subscription_status})`;
                    if (trialExp && t.tier === 'trial') dataContext += ` | trial expires: ${trialExp}`;
                    dataContext += '\n';
                });
            }
        }

    } catch (dbErr) {
        console.error('[AdminBot] DB context error:', dbErr.message);
        dataContext = '\n(Could not load live platform data)\n';
    }

    // ── BUILD MESSAGES ────────────────────────────────────────────────────────

    const systemPrompt = `You are a Technical Product Specialist for SyncStation — an internal AI assistant available only to the SyncStation admin team.

Your role:
- Help the admin team diagnose and resolve sync issues across all customer portals
- Provide clear, actionable technical guidance based on real log data
- Suggest specific fixes when you see error patterns
- Help the team understand what's happening for a specific portal or customer
- Be direct and technical — you're talking to the team who built this, not end users

SyncStation context:
- HubSpot property sync SaaS — syncs field values between associated CRM objects
- Standard objects use real-time webhooks; custom objects (Projects, Leads) use 15-min polling
- Tiers: Trial (7 days, 30 mappings), Starter ($10, 20 mappings), Pro ($15, 30 mappings), Business ($40, 100 mappings)
- Common errors: association not found, token expired (fix: OAuth reconnect), rate limit (auto-handled), mapping limit exceeded
- Polling runs every 15 minutes — if a customer reports delay, it's expected for custom objects
- Webhook errors for Projects/Leads are expected — HubSpot doesn't support custom object webhooks

Live platform data for this session:
${dataContext}

Guidelines:
- When you see error patterns, name the specific portal and error
- For "association not found" errors: the records aren't linked in HubSpot — user needs to create the association
- For "token expired" errors: portal needs to reconnect HubSpot via Account page → Connect HubSpot
- For "rate limit" errors: these auto-resolve — no action needed
- For "mapping limit" errors: portal is on a plan that doesn't allow more mappings — needs upgrade
- Always reference specific portal IDs, record IDs, and timestamps from the data when available
- Keep responses concise and actionable — what's wrong, why, and how to fix it`;

    const messages = [
        ...history.slice(-10).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
        })),
        { role: 'user', content: message }
    ];

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model:      'claude-sonnet-4-20250514',
                max_tokens: 1024,
                system:     systemPrompt,
                messages
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[AdminBot] API error:', data);
            return res.status(500).json({ error: 'AI service error', details: data.error?.message });
        }

        const reply = data.content?.[0]?.text || 'No response generated.';
        res.json({ reply });

    } catch (err) {
        console.error('[AdminBot] Error:', err.message);
        res.status(500).json({ error: 'Failed to get response from AI' });
    }
});

module.exports = router;
