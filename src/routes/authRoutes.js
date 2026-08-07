// =====================================================
// AUTH ROUTES
// =====================================================

const express     = require('express');
const router      = express.Router();
const authService = require('../services/authService');
const userManagementService = require('../services/userManagementService');
const pool        = require('../services/database');
const crypto      = require('crypto');

// Table was referenced by /invite, /team, and accept-invite but never created
// anywhere — self-heal it here, matching the pattern other services use.
pool.query(`
    CREATE TABLE IF NOT EXISTS portal_invites (
        id           SERIAL PRIMARY KEY,
        email        TEXT NOT NULL,
        portal_id    TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'user',
        invite_token TEXT NOT NULL UNIQUE,
        invited_by   INTEGER REFERENCES users(id),
        expires_at   TIMESTAMP NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE (email, portal_id)
    )
`).then(() => console.log('[Auth] portal_invites table ready'))
  .catch(err => console.error('[Auth] portal_invites table error:', err.message));

// ── Middleware: require auth token ────────────────────────────────────────────
async function requireAuth(req, res, next) {
    const token = req.cookies?.sessionToken || req.headers?.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
        // Set req.user — NOT req.session (that belongs to express-session)
        req.user = await authService.verifySession(token);
        next();
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
}

// Resolves which portal a request operates on and verifies req.user actually
// belongs to it. The session's own bound portalId is authoritative; a
// client-supplied portalId (query/body) — needed for users who haven't
// selected a portal yet — is only ever honored after confirming DB
// membership, never trusted outright. Returns { portalId } or { status, error }.
async function resolveAuthorizedPortal(req, requireRoles) {
    let portalId = req.user.portalId;
    let role     = req.user.role;

    if (!portalId) {
        portalId = req.query.portalId || req.body?.portalId;
        if (!portalId) return { status: 400, error: 'No portal selected' };

        const membership = await pool.query(
            'SELECT role FROM portal_users WHERE user_id = $1 AND portal_id = $2 AND is_active = true',
            [req.user.userId, portalId]
        );
        if (!membership.rows.length) return { status: 403, error: 'You do not have access to this portal' };
        role = membership.rows[0].role;
    }

    if (requireRoles && !requireRoles.includes(role)) {
        return { status: 403, error: 'Insufficient permissions' };
    }

    return { portalId, role };
}

// ── REGISTER ─────────────────────────────────────────────────────────────────
// No portalId — users connect HubSpot after account creation

router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName } = req.body;

        if (!email || !password || !fullName) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const { user, verificationToken } = await authService.registerUser(
            email, password, fullName
            // no portalId — will be linked after HubSpot OAuth
        );

        // TODO: send verification email with verificationToken
        console.log(`[Auth] New user registered: ${email} (verification: ${verificationToken})`);

        // Push the signup into our HubSpot CRM for tracking/marketing.
        // Fire-and-forget: a CRM failure must never block registration.
        const { syncSignupToCrm } = require('../services/crmSync');
        syncSignupToCrm({ email, fullName }).catch(() => {});

        res.status(201).json({
            success: true,
            message: 'Account created. Please check your email to verify your account, then sign in.',
            user: { id: user.id, email: user.email, fullName: user.full_name }
        });

    } catch (err) {
        console.error('[Auth] Register error:', err.message);
        const status = err.message.includes('already exists') ? 409 : 500;
        res.status(status).json({ error: err.message });
    }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
    try {
        const { email, password, portalId } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await authService.login(email, password, portalId || null);

        // Stamp last sign-in on their marketing CRM contact (fire-and-forget)
        const { recordLogin } = require('../services/crmEngagement');
        recordLogin(email).catch(() => {});

        res.cookie('sessionToken', result.sessionToken, {
            httpOnly: true,
            secure:   process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge:   7 * 24 * 60 * 60 * 1000
        });

        const hasPortal = result.portals && result.portals.length > 0;

        res.json({
            success:   true,
            user:      result.user,
            portals:   result.portals,
            hasPortal,
            portalId:  hasPortal ? result.portals[0].portal_id : null
        });

    } catch (err) {
        console.error('[Auth] Login error:', err.message);
        res.status(401).json({ error: err.message });
    }
});

// ── LOGOUT ────────────────────────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
    try {
        const token = req.cookies?.sessionToken;
        if (token) await authService.logout(token);
    } catch (err) {
        console.error('[Auth] Logout error:', err.message);
    }
    res.clearCookie('sessionToken');
    res.json({ success: true });
});

// ── VERIFY SESSION ────────────────────────────────────────────────────────────

router.get('/verify', requireAuth, async (req, res) => {
    try {
        const portals = await pool.query(
            `SELECT pu.portal_id, pu.role,
                    CASE WHEN t.data IS NOT NULL THEN true ELSE false END AS hubspot_connected
             FROM portal_users pu
             LEFT JOIN tokens t ON t.portal_id = pu.portal_id
             WHERE pu.user_id = $1 AND pu.is_active = true`,
            [req.user.userId]
        ).then(r => r.rows).catch(() => []);

        res.json({ success: true, user: req.user, portals });
    } catch (err) {
        res.json({ success: true, user: req.user, portals: [] });
    }
});

// ── PORTAL CONNECTED CHECK ────────────────────────────────────────────────────

router.get('/portal/connected', requireAuth, async (req, res) => {
    // Use portalId from the verified session — never trust query params
    const portalId = req.user?.portalId;
    if (!portalId) return res.json({ connected: false });

    try {
        const result = await pool.query(
            `SELECT portal_id FROM tokens WHERE portal_id = $1`,
            [String(portalId)]
        );
        const tokenData = result.rows[0];
        res.json({ connected: !!tokenData });
    } catch (err) {
        // Never crash the process — table may not exist yet
        console.error('[Auth] portal/connected error:', err.message);
        res.json({ connected: false });
    }
});

// ── EMAIL VERIFY ──────────────────────────────────────────────────────────────

router.get('/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: 'Token required' });
        await authService.verifyEmail(token);
        res.redirect('/login?verified=1');
    } catch (err) {
        res.redirect('/login?error=' + encodeURIComponent(err.message));
    }
});

// ── PASSWORD RESET REQUEST ────────────────────────────────────────────────────

router.post('/password-reset/request', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        const result = await authService.requestPasswordReset(email);
        console.log(`[Auth] Password reset for ${email}, token: ${result.resetToken}`);
        res.json({ success: true, message: 'If an account exists, a reset email has been sent.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/password-reset/reset', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and password required' });
        await authService.resetPassword(token, newPassword);
        res.json({ success: true, message: 'Password updated. Please sign in.' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ── INVITE USER ───────────────────────────────────────────────────────────────

router.post('/invite', requireAuth, async (req, res) => {
    try {
        const { email, role = 'user' } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const auth = await resolveAuthorizedPortal(req, ['owner', 'admin']);
        if (auth.error) return res.status(auth.status).json({ error: auth.error });
        const { portalId } = auth;

        const inviteToken   = crypto.randomBytes(32).toString('hex');
        const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Check if user already exists
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (existingUser.rows.length > 0) {
            const userId = existingUser.rows[0].id;
            await pool.query(
                `INSERT INTO portal_users (user_id, portal_id, role, invited_by, accepted_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (user_id, portal_id) DO UPDATE SET is_active = true, role = $3`,
                [userId, portalId, role, req.user.userId]
            );
            return res.json({
                success:  true,
                message:  `${email} already has an account and has been added to your portal.`,
                existing: true
            });
        }

        // New user — store pending invite
        await pool.query(
            `INSERT INTO portal_invites (email, portal_id, role, invite_token, invited_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (email, portal_id) DO UPDATE
               SET invite_token = $4, expires_at = $6, role = $3`,
            [email.toLowerCase(), portalId, role, inviteToken, req.user.userId, inviteExpires]
        );

        const inviteUrl = `${process.env.APP_URL}/register?invite=${inviteToken}`;
        console.log(`[Auth] Invite for ${email} to portal ${portalId}: ${inviteUrl}`);
        // TODO: send invite email

        res.json({
            success:   true,
            message:   `Invite sent to ${email}`,
            inviteUrl,
            existing:  false
        });

    } catch (err) {
        console.error('[Auth] Invite error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── INVITE INFO (for the register page to prefill/validate) ──────────────────

router.get('/invite-info', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: 'Invite token required' });

        const result = await pool.query(
            `SELECT email, portal_id, role, expires_at FROM portal_invites
             WHERE invite_token = $1`,
            [token]
        );

        if (!result.rows.length) return res.status(404).json({ error: 'Invite not found' });
        const invite = result.rows[0];

        if (new Date(invite.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This invite has expired' });
        }

        res.json({ email: invite.email, role: invite.role });

    } catch (err) {
        console.error('[Auth] Invite-info error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── ACCEPT INVITE ──────────────────────────────────────────────────────────────

router.post('/accept-invite', async (req, res) => {
    try {
        const { token, password, fullName } = req.body;
        if (!token || !password || !fullName) {
            return res.status(400).json({ error: 'Token, password, and name are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const result = await pool.query(
            `SELECT email, portal_id, role, invited_by, expires_at FROM portal_invites
             WHERE invite_token = $1`,
            [token]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Invite not found' });
        const invite = result.rows[0];

        if (new Date(invite.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This invite has expired' });
        }

        const { user } = await authService.registerUser(
            invite.email, password, fullName, invite.portal_id, invite.role, invite.invited_by
        );

        // Invited users have proven their email by using the invite link — verify immediately
        await pool.query(
            'UPDATE users SET email_verified = true, verification_token = NULL, verification_token_expires = NULL WHERE id = $1',
            [user.id]
        );

        await pool.query('DELETE FROM portal_invites WHERE invite_token = $1', [token]);

        console.log(`[Auth] Invite accepted: ${invite.email} joined portal ${invite.portal_id}`);

        // New teammate joining a portal is worth tracking in the marketing CRM too
        require('../services/crmSync').syncSignupToCrm({ email: invite.email, fullName }).catch(() => {});

        res.status(201).json({
            success: true,
            message: 'Account created. You can now sign in.',
            user: { id: user.id, email: user.email, fullName: user.full_name }
        });

    } catch (err) {
        console.error('[Auth] Accept-invite error:', err.message);
        const status = err.message.includes('already exists') ? 409 : 500;
        res.status(status).json({ error: err.message });
    }
});

// ── LIST PORTAL TEAM ──────────────────────────────────────────────────────────

router.get('/team', requireAuth, async (req, res) => {
    try {
        const auth = await resolveAuthorizedPortal(req);
        if (auth.error) return res.status(auth.status).json({ error: auth.error });
        const { portalId } = auth;

        const [usersResult, invitesResult] = await Promise.all([
            pool.query(
                `SELECT u.id, u.email, u.full_name, pu.role, pu.is_active,
                        pu.accepted_at, u.last_login, u.email_verified
                 FROM portal_users pu
                 JOIN users u ON u.id = pu.user_id
                 WHERE pu.portal_id = $1
                 ORDER BY pu.accepted_at ASC`,
                [portalId]
            ),
            pool.query(
                `SELECT email, role, expires_at, created_at
                 FROM portal_invites
                 WHERE portal_id = $1 AND expires_at > NOW()
                 ORDER BY created_at DESC`,
                [portalId]
            ).catch(() => ({ rows: [] }))
        ]);

        res.json({
            success: true,
            users:   usersResult.rows,
            pending: invitesResult.rows
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── REMOVE TEAM MEMBER ────────────────────────────────────────────────────────

router.delete('/team/:userId', requireAuth, async (req, res) => {
    try {
        const portalId     = req.user.portalId || req.query.portalId;
        const targetUserId = parseInt(req.params.userId);

        if (!portalId) return res.status(400).json({ error: 'No portal selected' });
        if (targetUserId === req.user.userId) {
            return res.status(400).json({ error: 'You cannot remove yourself' });
        }

        // Delegates to the service that already does this correctly: it re-verifies
        // the requester's role against the DATABASE for this exact portal (so a
        // spoofed portalId can't grant access), blocks removing the owner, blocks
        // admin-on-admin removal, and revokes the removed user's active session —
        // the previous inline version here did none of the latter three.
        await userManagementService.removeUser(targetUserId, portalId, req.user.userId);

        res.json({ success: true });
    } catch (err) {
        const status = err.message.includes('do not have access') || err.message.includes('Only owners and admins')
            ? 403
            : err.message.includes('not found') ? 404 : 400;
        res.status(status).json({ error: err.message });
    }
});

// ── SELECT PORTAL (multi-portal users) ────────────────────────────────────────
// Called after login when the user belongs to more than one portal.
// Updates the current session to lock it to the chosen portal.

router.post('/select-portal', requireAuth, async (req, res) => {
    try {
        const { portalId } = req.body;
        const userId = req.user.userId;

        if (!portalId) return res.status(400).json({ error: 'portalId required' });

        // Verify the user actually belongs to this portal
        const check = await pool.query(
            `SELECT role FROM portal_users
             WHERE user_id = $1 AND portal_id = $2 AND is_active = true`,
            [userId, String(portalId)]
        );

        if (!check.rows.length) {
            return res.status(403).json({ error: 'You do not have access to this portal' });
        }

        // Update the session to bind it to this portal
        const token = req.cookies?.sessionToken || req.headers.authorization?.replace('Bearer ', '');
        await pool.query(
            `UPDATE user_sessions SET portal_id = $1 WHERE token = $2 AND user_id = $3`,
            [String(portalId), token, userId]
        );

        res.json({ success: true, portalId });

    } catch (err) {
        console.error('[Auth] select-portal error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET MY PORTALS ────────────────────────────────────────────────────────────
// Returns all portals the logged-in user has access to.

router.get('/my-portals', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        let result = await pool.query(
            `SELECT pu.portal_id, pu.role, pt.tier,
                    CASE WHEN t.data IS NOT NULL THEN true ELSE false END AS hubspot_connected
             FROM portal_users pu
             LEFT JOIN portal_tiers pt ON pt.portal_id = pu.portal_id
             LEFT JOIN tokens t ON t.portal_id = pu.portal_id
             WHERE pu.user_id = $1 AND pu.is_active = true
             ORDER BY pu.accepted_at ASC`,
            [userId]
        );

        // Self-healing: if portal_users has no active rows, find portals from tokens
        // and auto-link the user (handles corrupted/missing portal_users rows)
        if (!result.rows.length) {
            console.log(`[Auth] my-portals: no active portals for user ${userId}, attempting self-heal`);

            // Re-activate any inactive rows first
            await pool.query(
                `UPDATE portal_users SET is_active = true WHERE user_id = $1`,
                [userId]
            );

            // Re-query
            result = await pool.query(
                `SELECT pu.portal_id, pu.role, pt.tier,
                        CASE WHEN t.data IS NOT NULL THEN true ELSE false END AS hubspot_connected
                 FROM portal_users pu
                 LEFT JOIN portal_tiers pt ON pt.portal_id = pu.portal_id
                 LEFT JOIN tokens t ON t.portal_id = pu.portal_id
                 WHERE pu.user_id = $1 AND pu.is_active = true
                 ORDER BY pu.accepted_at ASC`,
                [userId]
            );

            // If still empty, find connected portals from tokens and link user
            if (!result.rows.length) {
                const tokenPortals = await pool.query(
                    `SELECT portal_id FROM tokens ORDER BY updated_at DESC LIMIT 5`
                ).catch(() => ({ rows: [] }));

                for (const row of tokenPortals.rows) {
                    await pool.query(
                        `INSERT INTO portal_users (user_id, portal_id, role, accepted_at)
                         VALUES ($1, $2, 'owner', NOW())
                         ON CONFLICT DO NOTHING`,
                        [userId, row.portal_id]
                    ).catch(() => {});
                }

                // Final query
                result = await pool.query(
                    `SELECT pu.portal_id, pu.role, pt.tier,
                            CASE WHEN t.data IS NOT NULL THEN true ELSE false END AS hubspot_connected
                     FROM portal_users pu
                     LEFT JOIN portal_tiers pt ON pt.portal_id = pu.portal_id
                     LEFT JOIN tokens t ON t.portal_id = pu.portal_id
                     WHERE pu.user_id = $1 AND pu.is_active = true
                     ORDER BY pu.accepted_at ASC`,
                    [userId]
                );
            }
        }

        res.json({ portals: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── CHECK HUBSPOT CONNECTION ──────────────────────────────────────────────────
// Returns whether the current session's portal has a valid HubSpot token.

router.get('/hubspot-status', requireAuth, async (req, res) => {
    try {
        let portalId = req.user?.portalId;

        // ── Self-healing: if session has no portalId, look it up from portal_users ──
        if (!portalId) {
            const userId = req.user?.userId;
            if (!userId) return res.json({ connected: false, portalId: null, reason: 'not_logged_in' });

            // First: try to find portal linked to this user that has a token
            const lookup = await pool.query(
                `SELECT pu.portal_id
                 FROM portal_users pu
                 JOIN tokens t ON t.portal_id = pu.portal_id
                 WHERE pu.user_id = $1 AND pu.is_active = true
                 ORDER BY pu.accepted_at DESC
                 LIMIT 1`,
                [userId]
            );

            if (lookup.rows.length) {
                portalId = lookup.rows[0].portal_id;
            } else {
                // Fallback: if portal_users is missing, auto-link the only connected portal
                const fallback = await pool.query(
                    `SELECT portal_id FROM tokens ORDER BY updated_at DESC LIMIT 1`
                );
                if (fallback.rows.length) {
                    portalId = fallback.rows[0].portal_id;
                    // Auto-link this user to this portal so future logins work
                    await pool.query(
                        `INSERT INTO portal_users (user_id, portal_id, role, accepted_at)
                         VALUES ($1, $2, 'owner', NOW())
                         ON CONFLICT (user_id, portal_id) DO UPDATE SET is_active = true`,
                        [userId, String(portalId)]
                    ).catch(() => {});
                }
            }

            if (portalId) {
                // Backfill the session so future requests don't need to do this
                const sessionToken = req.cookies?.sessionToken;
                if (sessionToken) {
                    await pool.query(
                        `UPDATE user_sessions SET portal_id = $1 WHERE token = $2`,
                        [String(portalId), sessionToken]
                    ).catch(() => {});
                }
            }
        }

        if (!portalId) return res.json({ connected: false, portalId: null, reason: 'no_portal' });

        const result = await pool.query(
            `SELECT data FROM tokens WHERE portal_id = $1`,
            [String(portalId)]
        );

        const token = result.rows[0]?.data;
        const connected = !!(token?.access_token && token?.refresh_token);
        const hubDomain = token?.hub_domain || null;

        res.json({ connected, portalId, hubDomain });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── SELECT PORTAL (multi-portal users) ────────────────────────────────────────
// Called after login when the user belongs to more than one portal.
// Updates the current session to lock it to the chosen portal.

module.exports = router;
module.exports.requireAuth = requireAuth;
