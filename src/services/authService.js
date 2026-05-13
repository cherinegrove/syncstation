// =====================================================
// AUTHENTICATION SERVICE
// =====================================================

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool   = require('./database');

const SALT_ROUNDS = 10;

class AuthService {

    // ── REGISTER ──────────────────────────────────────────────────────────────
    // portalId is now OPTIONAL — users register first, connect HubSpot after

    async registerUser(email, password, fullName, portalId = null, role = 'owner', invitedBy = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const existing = await client.query(
                'SELECT id FROM users WHERE email = $1',
                [email.toLowerCase()]
            );
            if (existing.rows.length > 0) {
                throw new Error('An account with this email already exists');
            }

            const passwordHash        = await bcrypt.hash(password, SALT_ROUNDS);
            const verificationToken   = crypto.randomBytes(32).toString('hex');
            const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const userResult = await client.query(
                `INSERT INTO users (email, password_hash, full_name, verification_token, verification_token_expires)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, email, full_name, created_at`,
                [email.toLowerCase(), passwordHash, fullName, verificationToken, verificationExpires]
            );
            const user = userResult.rows[0];

            // Only link to portal if one was provided (e.g. invited users)
            if (portalId) {
                await client.query(
                    `INSERT INTO portal_users (user_id, portal_id, role, invited_by, accepted_at)
                     VALUES ($1, $2, $3, $4, NOW())`,
                    [user.id, portalId, role, invitedBy]
                );

                if (role === 'owner') {
                    await client.query(
                        `INSERT INTO portal_tiers (portal_id, tier, created_at)
                         VALUES ($1, 'trial', NOW())
                         ON CONFLICT (portal_id) DO NOTHING`,
                        [String(portalId)]
                    ).catch(e => console.log('[Auth] Could not set trial tier:', e.message));
                }
            }

            await client.query('COMMIT');
            return { user, verificationToken };

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ── LINK USER TO PORTAL ───────────────────────────────────────────────────
    // Called after HubSpot OAuth completes to connect the account to a portal

    async linkUserToPortal(userId, portalId, role = 'owner') {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // UPDATE first — no unique constraint needed
            const updated = await client.query(
                `UPDATE portal_users SET is_active = true, role = $3
                 WHERE user_id = $1 AND portal_id = $2`,
                [userId, String(portalId), role]
            );

            // INSERT only if nothing was updated
            if (updated.rowCount === 0) {
                await client.query(
                    `INSERT INTO portal_users (user_id, portal_id, role, accepted_at)
                     VALUES ($1, $2, $3, NOW())`,
                    [userId, String(portalId), role]
                ).catch(() => {}); // ignore race-condition duplicate
            }

            // Set trial tier
            await client.query(
                `INSERT INTO portal_tiers (portal_id, tier, created_at)
                 VALUES ($1, 'trial', NOW())
                 ON CONFLICT (portal_id) DO NOTHING`,
                [String(portalId)]
            );

            // Update session
            await client.query(
                `UPDATE user_sessions SET portal_id = $1 WHERE user_id = $2`,
                [String(portalId), userId]
            );

            await client.query('COMMIT');
            console.log(`[Auth] linkUserToPortal: user ${userId} linked to portal ${portalId}`);
            return { success: true };
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('[Auth] linkUserToPortal error:', err.message);
            // Always update the session even if something else failed
            await pool.query(
                `UPDATE user_sessions SET portal_id = $1 WHERE user_id = $2`,
                [String(portalId), userId]
            ).catch(() => {});
            return { success: false, error: err.message };
        } finally {
            client.release();
        }
    }

    // ── LOGIN ─────────────────────────────────────────────────────────────────

    async login(email, password, portalId = null) {
        const userResult = await pool.query(
            `SELECT id, email, password_hash, full_name, is_active, email_verified
             FROM users WHERE email = $1`,
            [email.toLowerCase()]
        );

        if (!userResult.rows.length) throw new Error('Invalid email or password');

        const user = userResult.rows[0];
        if (!user.is_active) throw new Error('Account has been deactivated');

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) throw new Error('Invalid email or password');

        // Get all portals this user has access to
        let portalAccess = [];
        if (portalId) {
            const r = await pool.query(
                `SELECT portal_id, role, is_active FROM portal_users
                 WHERE user_id = $1 AND portal_id = $2 AND is_active = true`,
                [user.id, portalId]
            );
            if (!r.rows.length) throw new Error('You do not have access to this portal');
            portalAccess = r.rows;
        } else {
            const r = await pool.query(
                `SELECT portal_id, role, is_active FROM portal_users
                 WHERE user_id = $1 AND is_active = true`,
                [user.id]
            );
            portalAccess = r.rows;
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const sessionPortal = portalId || (portalAccess.length === 1 ? portalAccess[0].portal_id : null);

        await pool.query(
            `INSERT INTO user_sessions (user_id, portal_id, token, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [user.id, sessionPortal, sessionToken, expiresAt]
        );

        await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

        return {
            user: {
                id:            user.id,
                email:         user.email,
                fullName:      user.full_name,
                emailVerified: user.email_verified
            },
            portals:      portalAccess,
            sessionToken,
            expiresAt
        };
    }

    // ── VERIFY SESSION ────────────────────────────────────────────────────────

    async verifySession(sessionToken) {
        const result = await pool.query(
            `SELECT s.user_id, s.portal_id, s.expires_at,
                    u.email, u.full_name, u.is_active,
                    pu.role
             FROM user_sessions s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN portal_users pu ON pu.user_id = s.user_id AND pu.portal_id = s.portal_id
             WHERE s.token = $1`,
            [sessionToken]
        );

        if (!result.rows.length)                                        throw new Error('Invalid session');
        if (new Date(result.rows[0].expires_at) < new Date())           throw new Error('Session expired');
        if (!result.rows[0].is_active)                                  throw new Error('Account deactivated');

        await pool.query(
            'UPDATE user_sessions SET last_activity = NOW() WHERE token = $1',
            [sessionToken]
        );

        const s = result.rows[0];
        return {
            userId:   s.user_id,
            email:    s.email,
            fullName: s.full_name,
            portalId: s.portal_id,
            role:     s.role
        };
    }

    // ── PASSWORD RESET ────────────────────────────────────────────────────────

    async requestPasswordReset(email) {
        const r = await pool.query(
            'SELECT id, email, full_name FROM users WHERE email = $1',
            [email.toLowerCase()]
        );
        if (!r.rows.length) return { success: true };

        const user       = r.rows[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt  = new Date(Date.now() + 60 * 60 * 1000);

        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, resetToken, expiresAt]
        );

        return { success: true, user, resetToken };
    }

    async resetPassword(resetToken, newPassword) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const r = await client.query(
                'SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
                [resetToken]
            );
            if (!r.rows.length)                                    throw new Error('Invalid reset token');
            if (r.rows[0].used)                                    throw new Error('Reset token already used');
            if (new Date(r.rows[0].expires_at) < new Date())       throw new Error('Reset token has expired');

            const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
            await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, r.rows[0].user_id]);
            await client.query('UPDATE password_reset_tokens SET used = true WHERE token = $1', [resetToken]);
            await client.query('DELETE FROM user_sessions WHERE user_id = $1', [r.rows[0].user_id]);

            await client.query('COMMIT');
            return { success: true };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ── LOGOUT ────────────────────────────────────────────────────────────────

    async logout(sessionToken) {
        await pool.query('DELETE FROM user_sessions WHERE token = $1', [sessionToken]);
        return { success: true };
    }

    // ── EMAIL VERIFICATION ────────────────────────────────────────────────────

    async verifyEmail(verificationToken) {
        const result = await pool.query(
            `UPDATE users
             SET email_verified = true, verification_token = NULL, verification_token_expires = NULL
             WHERE verification_token = $1
               AND verification_token_expires > NOW()
               AND email_verified = false
             RETURNING id, email`,
            [verificationToken]
        );
        if (!result.rows.length) throw new Error('Invalid or expired verification token');
        return { success: true, user: result.rows[0] };
    }
}

module.exports = new AuthService();
