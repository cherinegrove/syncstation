// =====================================================
// AUTH ROUTES
// =====================================================

const express     = require('express');
const router      = express.Router();
const authService = require('../services/authService');
const pool        = require('../services/database');
const crypto      = require('crypto');

// ── Middleware: require auth token ────────────────────────────────────────────
async function requireAuth(req, res, next) {
    const token = req.cookies?.sessionToken || req.headers?.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
        req.session = await authService.verifySession(token);
        next();
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
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
                    COALESCE(ht.access_token IS NOT NULL, false) AS hubspot_connected
             FROM portal_users pu
             LEFT JOIN hubspot_tokens ht ON ht.portal_id = pu.portal_id
             WHERE pu.user_id = $1 AND pu.is_active = true`,
            [req.session.userId]
        ).then(r => r.rows).catch(() => []);

        res.json({ success: true, user: req.session, portals });
    } catch (err) {
        res.json({ success: true, user: req.session, portals: [] });
    }
});

// ── PORTAL CONNECTED CHECK ────────────────────────────────────────────────────

router.get('/portal/connected', requireAuth, async (req, res) => {
    const { portalId } = req.query;
    if (!portalId) return res.status(400).json({ error: 'portalId required' });

    try {
        const result = await pool.query(
            `SELECT id FROM hubspot_tokens WHERE portal_id = $1 AND access_token IS NOT NULL`,
            [String(portalId)]
        );
        res.json({ connected: result.rows.length > 0 });
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
        const portalId = req.session.portalId || req.query.portalId || req.body.portalId;

        if (!portalId) return res.status(400).json({ error: 'No portal associated with this session' });
        if (!email)    return res.status(400).json({ error: 'Email is required' });

        if (!['owner', 'admin'].includes(req.session.role)) {
            return res.status(403).json({ error: 'Only portal owners and admins can invite users' });
        }

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
                [userId, portalId, role, req.session.userId]
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
            [email.toLowerCase(), portalId, role, inviteToken, req.session.userId, inviteExpires]
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

// ── LIST PORTAL TEAM ──────────────────────────────────────────────────────────

router.get('/team', requireAuth, async (req, res) => {
    try {
        const portalId = req.session.portalId || req.query.portalId;
        if (!portalId) return res.status(400).json({ error: 'portalId required' });

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
        const portalId     = req.session.portalId || req.query.portalId;
        const targetUserId = parseInt(req.params.userId);

        if (!['owner', 'admin'].includes(req.session.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        if (targetUserId === req.session.userId) {
            return res.status(400).json({ error: 'You cannot remove yourself' });
        }

        await pool.query(
            `UPDATE portal_users SET is_active = false WHERE user_id = $1 AND portal_id = $2`,
            [targetUserId, portalId]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── SELECT PORTAL (multi-portal users) ────────────────────────────────────────
// Called after login when the user belongs to more than one portal.
// Updates the current session to lock it to the chosen portal.

router.post('/select-portal', requireAuth, async (req, res) => {
    try {
        const { portalId } = req.body;
        const userId = req.session.userId;

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
        const userId = req.session.userId;
        const result = await pool.query(
            `SELECT pu.portal_id, pu.role, pt.tier,
                    ht.hub_domain,
                    CASE WHEN t.data IS NOT NULL THEN true ELSE false END AS hubspot_connected
             FROM portal_users pu
             LEFT JOIN portal_tiers pt ON pt.portal_id = pu.portal_id
             LEFT JOIN hubspot_tokens ht ON ht.portal_id = pu.portal_id
             LEFT JOIN tokens t ON t.portal_id = pu.portal_id
             WHERE pu.user_id = $1 AND pu.is_active = true
             ORDER BY pu.accepted_at ASC`,
            [userId]
        );
        res.json({ portals: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── CHECK HUBSPOT CONNECTION ──────────────────────────────────────────────────
// Returns whether the current session's portal has a valid HubSpot token.

router.get('/hubspot-status', requireAuth, async (req, res) => {
    try {
        const portalId = req.session.portalId;
        if (!portalId) return res.json({ connected: false, reason: 'no_portal' });

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

router.post('/select-portal', requireAuth, async (req, res) => {
    try {
        const { portalId } = req.body;
        const userId = req.session.userId;

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
        const userId = req.session.userId;
        const result = await pool.query(
            `SELECT pu.portal_id, pu.role, pt.tier,
                    ht.hub_domain,
                    CASE WHEN t.data IS NOT NULL THEN true ELSE false END AS hubspot_connected
             FROM portal_users pu
             LEFT JOIN portal_tiers pt ON pt.portal_id = pu.portal_id
             LEFT JOIN hubspot_tokens ht ON ht.portal_id = pu.portal_id
             LEFT JOIN tokens t ON t.portal_id = pu.portal_id
             WHERE pu.user_id = $1 AND pu.is_active = true
             ORDER BY pu.accepted_at ASC`,
            [userId]
        );
        res.json({ portals: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── CHECK HUBSPOT CONNECTION ──────────────────────────────────────────────────
// Returns whether the current session's portal has a valid HubSpot token.

router.get('/hubspot-status', requireAuth, async (req, res) => {
    try {
        const portalId = req.session.portalId;
        if (!portalId) return res.json({ connected: false, reason: 'no_portal' });

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

module.exports = router;
