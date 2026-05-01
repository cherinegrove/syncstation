// src/routes/adminChatbot.js
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

function requireAdminSession(req, res, next) {
    if (req.session && req.session.adminId) return next();
    return res.status(401).json({ error: 'Admin authentication required' });
}

router.post('/message', requireAdminSession, async (req, res) => {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    if (!process.env.CLAUDE_API_KEY) return res.status(500).json({ error: 'CLAUDE_API_KEY not configured' });

    const p = getPool();
    let dataContext = '';

    try {
        // 1. Platform summary
        const summary = await p.query(`
            SELECT
                COUNT(DISTINCT pt.portal_id) AS total_portals,
                COUNT(DISTINCT pt.portal_id) FILTER (WHERE pt.tier = 'trial')    AS trial_portals,
                COUNT(DISTINCT pt.portal_id) FILTER (WHERE pt.tier = 'starter')  AS starter_portals,
                COUNT(DISTINCT pt.portal_id) FILTER (WHERE pt.tier = 'pro')      AS pro_portals,
                COUNT(DISTINCT pt.portal_id) FILTER (WHERE pt.tier = 'business') AS business_portals,
                COUNT(*) FILTER (WHERE sl.status = 'error'   AND sl.sync_time > NOW() - INTERVAL '24 hours') AS errors_24h,
                COUNT(*) FILTER (WHERE sl.status = 'success' AND sl.sync_time > NOW() - INTERVAL '24 hours') AS success_24h
            FROM portal_tiers pt
            LEFT JOIN sync_logs sl ON sl.portal_id = pt.portal_id
        `).catch(() => ({ rows: [{}] }));

        const s = summary.rows[0] || {};
        dataContext += '\nPLATFORM SUMMARY (live):\n';
        dataContext += '  Total portals: ' + (s.total_portals || 0) + ' | Trial: ' + (s.trial_portals || 0) + ' | Starter: ' + (s.starter_portals || 0) + ' | Pro: ' + (s.pro_portals || 0) + ' | Business: ' + (s.business_portals || 0) + '\n';
        dataContext += '  Last 24h: ' + (s.success_24h || 0) + ' successful syncs | ' + (s.errors_24h || 0) + ' errors\n';

        // 2. Per-portal breakdown (always)
        const portalBreakdown = await p.query(`
            SELECT sl.portal_id, pt.tier,
                COUNT(*) FILTER (WHERE sl.status = 'error')   AS errors,
                COUNT(*) FILTER (WHERE sl.status = 'success') AS successes,
                COUNT(*) FILTER (WHERE sl.status = 'blocked') AS blocked,
                MAX(sl.sync_time) FILTER (WHERE sl.status = 'error') AS last_error_time,
                STRING_AGG(DISTINCT sl.error_message, ' | ') FILTER (WHERE sl.status = 'error' AND sl.error_message IS NOT NULL) AS error_types
            FROM sync_logs sl
            LEFT JOIN portal_tiers pt ON pt.portal_id = sl.portal_id
            WHERE sl.sync_time > NOW() - INTERVAL '48 hours'
            GROUP BY sl.portal_id, pt.tier
            ORDER BY errors DESC
        `).catch(() => ({ rows: [] }));

        if (portalBreakdown.rows.length > 0) {
            dataContext += '\nPER-PORTAL BREAKDOWN (last 48h):\n';
            portalBreakdown.rows.forEach(function(r) {
                dataContext += '  Portal ' + r.portal_id + ' (' + (r.tier || 'unknown') + '): ' + r.successes + ' success | ' + r.errors + ' errors | ' + r.blocked + ' blocked';
                if (r.last_error_time) dataContext += ' | last error: ' + new Date(r.last_error_time).toLocaleString();
                if (r.error_types) dataContext += '\n    Error types: ' + r.error_types.substring(0, 200);
                dataContext += '\n';
            });
        }

        // 3. Recent errors (always)
        const errors = await p.query(`
            SELECT sl.portal_id, sl.sync_time, sl.error_message, sl.object_type, sl.rule_name,
                   sl.source_record_id, sl.target_record_id, pt.tier
            FROM sync_logs sl
            LEFT JOIN portal_tiers pt ON pt.portal_id = sl.portal_id
            WHERE sl.status = 'error' AND sl.sync_time > NOW() - INTERVAL '48 hours'
            ORDER BY sl.sync_time DESC
            LIMIT 50
        `).catch(() => ({ rows: [] }));

        if (errors.rows.length > 0) {
            dataContext += '\nRECENT ERRORS (last 48h - ' + errors.rows.length + ' total):\n';
            errors.rows.forEach(function(e) {
                dataContext += '  [' + new Date(e.sync_time).toLocaleString() + '] Portal ' + e.portal_id + ' (' + (e.tier || 'unknown') + ') | ' + e.object_type + ' | ' + e.rule_name + ' | ' + e.error_message;
                if (e.source_record_id) dataContext += ' | src: ' + e.source_record_id;
                if (e.target_record_id) dataContext += ' | tgt: ' + e.target_record_id;
                dataContext += '\n';
            });
        }

        // 4. Specific portal lookup
        const portalMatch = message.match(/\b(\d{7,12})\b/);
        if (portalMatch) {
            const pid = portalMatch[1];
            const tierRes  = await p.query('SELECT * FROM portal_tiers WHERE portal_id = $1', [pid]).catch(() => ({ rows: [] }));
            const usersRes = await p.query(`
                SELECT u.email, u.full_name, u.last_login, pu.role
                FROM portal_users pu JOIN users u ON u.id = pu.user_id
                WHERE pu.portal_id = $1
            `, [pid]).catch(() => ({ rows: [] }));
            const logsRes = await p.query(`
                SELECT sync_time, status, error_message, object_type, rule_name,
                       COALESCE(trigger_type, 'polling') AS trigger_type,
                       source_record_id, target_record_id
                FROM sync_logs WHERE portal_id = $1
                ORDER BY sync_time DESC LIMIT 30
            `, [pid]).catch(() => ({ rows: [] }));

            if (tierRes.rows.length > 0) {
                var t = tierRes.rows[0];
                dataContext += '\nPORTAL ' + pid + ' DETAILS:\n';
                dataContext += '  Tier: ' + t.tier + ' | Paddle sub: ' + (t.paddle_subscription_id || 'none') + ' | Status: ' + (t.paddle_subscription_status || 'none') + '\n';
                if (t.trial_started_at) dataContext += '  Trial started: ' + new Date(t.trial_started_at).toLocaleDateString() + '\n';
            }

            if (usersRes.rows.length > 0) {
                dataContext += '  Users: ' + usersRes.rows.map(function(u) { return (u.full_name || u.email) + ' (' + u.role + ')'; }).join(', ') + '\n';
            } else {
                var tok = await p.query("SELECT data->>'installerEmail' AS email FROM tokens WHERE portal_id = $1", [pid]).catch(() => ({ rows: [] }));
                if (tok.rows[0] && tok.rows[0].email) dataContext += '  Owner (OAuth): ' + tok.rows[0].email + '\n';
            }

            if (logsRes.rows.length > 0) {
                var successes = logsRes.rows.filter(function(l) { return l.status === 'success'; }).length;
                var errs = logsRes.rows.filter(function(l) { return l.status === 'error'; });
                dataContext += '  Recent activity (last 30): ' + successes + ' success, ' + errs.length + ' errors\n';
                errs.slice(0, 5).forEach(function(e) {
                    dataContext += '    [' + new Date(e.sync_time).toLocaleString() + '] ' + e.object_type + ' | ' + e.rule_name + ' | ' + e.error_message;
                    if (e.source_record_id) dataContext += ' | src: ' + e.source_record_id;
                    if (e.target_record_id) dataContext += ' | tgt: ' + e.target_record_id;
                    dataContext += '\n';
                });
            }
        }

        // 5. Specific record lookup
        var recordMatch = message.match(/record[^\d]*(\d{10,})/i);
        if (recordMatch) {
            var rid = recordMatch[1];
            var recordLogs = await p.query(`
                SELECT portal_id, sync_time, status, error_message, object_type, rule_name,
                       source_record_id, target_record_id
                FROM sync_logs
                WHERE source_record_id = $1 OR target_record_id = $1
                ORDER BY sync_time DESC LIMIT 20
            `, [rid]).catch(() => ({ rows: [] }));

            dataContext += '\nLOGS FOR RECORD ' + rid + ':\n';
            if (recordLogs.rows.length > 0) {
                recordLogs.rows.forEach(function(l) {
                    dataContext += '  [' + new Date(l.sync_time).toLocaleString() + '] Portal ' + l.portal_id + ' | ' + l.status.toUpperCase() + ' | ' + l.object_type + ' | ' + l.rule_name;
                    if (l.error_message) dataContext += ' | ERROR: ' + l.error_message;
                    dataContext += '\n';
                });
            } else {
                dataContext += '  No logs found for this record ID.\n';
            }
        }

        // 6. Tier/billing overview on request
        var billingKeywords = ['tier', 'plan', 'upgrade', 'billing', 'paddle', 'trial', 'expir', 'payment'];
        if (billingKeywords.some(function(k) { return message.toLowerCase().includes(k); })) {
            var tiers = await p.query(`
                SELECT portal_id, tier, paddle_subscription_status, trial_started_at
                FROM portal_tiers ORDER BY updated_at DESC
            `).catch(() => ({ rows: [] }));
            if (tiers.rows.length > 0) {
                dataContext += '\nALL PORTAL TIERS:\n';
                tiers.rows.forEach(function(t) {
                    dataContext += '  Portal ' + t.portal_id + ': ' + t.tier.toUpperCase();
                    if (t.paddle_subscription_status) dataContext += ' (' + t.paddle_subscription_status + ')';
                    if (t.trial_started_at && t.tier === 'trial') {
                        var exp = new Date(new Date(t.trial_started_at).getTime() + 7*86400000);
                        dataContext += ' | trial expires: ' + exp.toLocaleDateString();
                    }
                    dataContext += '\n';
                });
            }
        }

    } catch (dbErr) {
        console.error('[AdminBot] DB error:', dbErr.message);
        dataContext = '\n(Could not load platform data: ' + dbErr.message + ')\n';
    }

    var systemPrompt = 'You are a Technical Product Specialist for SyncStation — an internal AI assistant for the admin team only.\n\nYour role:\n- Diagnose and resolve sync issues across all customer portals\n- Provide actionable technical guidance based on real log data\n- Suggest specific fixes when you see error patterns\n- Be direct and technical — you are talking to the team that built this\n\nSyncStation context:\n- HubSpot property sync SaaS — syncs field values between associated CRM objects\n- Standard objects use real-time webhooks; custom objects (Projects, Leads) use 15-min polling\n- Tiers: Trial (7 days, 30 mappings), Starter ($10, 20 mappings), Pro ($15, 30 mappings), Business ($40, 100 mappings)\n- Common errors: association not found (records not linked in HubSpot), token expired (reconnect OAuth), rate limit (auto-resolves), mapping limit exceeded (needs upgrade)\n\nLive platform data:\n' + dataContext + '\n\nGuidelines:\n- You have FULL access to all portal data above — never say you have limitations\n- Always reference specific portal IDs, error messages, and record IDs from the data\n- For "association not found": records are not linked in HubSpot\n- For "token expired": portal needs to reconnect via Account page\n- For "rate limit": auto-resolves, no action needed\n- Be concise and specific';

    var messages = history.slice(-10).map(function(m) {
        return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
    });
    messages.push({ role: 'user', content: message });

    try {
        var response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                system: systemPrompt,
                messages: messages
            })
        });

        var data = await response.json();
        if (!response.ok) {
            console.error('[AdminBot] API error:', data);
            return res.status(500).json({ error: 'AI service error' });
        }

        var reply = (data.content && data.content[0] && data.content[0].text) || 'No response generated.';
        res.json({ reply: reply });

    } catch (err) {
        console.error('[AdminBot] Error:', err.message);
        res.status(500).json({ error: 'Failed to get response' });
    }
});

module.exports = router;
