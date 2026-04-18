// =====================================================
// AUTHENTICATION SERVICE
// Handles user login, registration, password reset
// =====================================================

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('./database');

const SALT_ROUNDS = 10;

class AuthService {
    // ==================== USER REGISTRATION ====================
    
    /**
     * Register a new user and link to portal
     * @param {string} email 
     * @param {string} password 
     * @param {string} fullName 
     * @param {string} portalId 
     * @param {string} role - 'owner', 'admin', or 'user'
     * @param {number} invitedBy - User ID of inviter (optional)
     */
    async registerUser(email, password, fullName, portalId, role = 'user', invitedBy = null) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Check if user already exists
            const existingUser = await client.query(
                'SELECT id FROM users WHERE email = $1',
                [email.toLowerCase()]
            );
            
            if (existingUser.rows.length > 0) {
                throw new Error('User with this email already exists');
            }
            
            // Hash password
            const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
            
            // Generate email verification token
            const verificationToken = crypto.randomBytes(32).toString('hex');
            const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
            
            // Create user
            const userResult = await client.query(
                `INSERT INTO users (email, password_hash, full_name, verification_token, verification_token_expires)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, email, full_name, created_at`,
                [email.toLowerCase(), passwordHash, fullName, verificationToken, verificationExpires]
            );
            
            const user = userResult.rows[0];
            
            // Link user to portal
            await client.query(
                `INSERT INTO portal_users (user_id, portal_id, role, invited_by, accepted_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [user.id, portalId, role, invitedBy]
            );
            
            await client.query('COMMIT');
            
            return {
                user,
                verificationToken // Send this via email
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    
    // ==================== USER LOGIN ====================
    
    /**
     * Authenticate user and create session
     * @param {string} email 
     * @param {string} password 
     * @param {string} portalId - Optional, to check portal access
     */
    async login(email, password, portalId = null) {
        try {
            // Get user
            const userResult = await pool.query(
                `SELECT id, email, password_hash, full_name, is_active, email_verified
                 FROM users
                 WHERE email = $1`,
                [email.toLowerCase()]
            );
            
            if (userResult.rows.length === 0) {
                throw new Error('Invalid email or password');
            }
            
            const user = userResult.rows[0];
            
            // Check if user is active
            if (!user.is_active) {
                throw new Error('Account has been deactivated');
            }
            
            // Verify password
            const passwordMatch = await bcrypt.compare(password, user.password_hash);
            if (!passwordMatch) {
                throw new Error('Invalid email or password');
            }
            
            // If portalId provided, check access
            let portalAccess = [];
            if (portalId) {
                const accessResult = await pool.query(
                    `SELECT portal_id, role, is_active
                     FROM portal_users
                     WHERE user_id = $1 AND portal_id = $2 AND is_active = true`,
                    [user.id, portalId]
                );
                
                if (accessResult.rows.length === 0) {
                    throw new Error('You do not have access to this portal');
                }
                
                portalAccess = accessResult.rows;
            } else {
                // Get all portals user has access to
                const accessResult = await pool.query(
                    `SELECT portal_id, role, is_active
                     FROM portal_users
                     WHERE user_id = $1 AND is_active = true`,
                    [user.id]
                );
                
                portalAccess = accessResult.rows;
            }
            
            // Create session token
            const sessionToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
            
            await pool.query(
                `INSERT INTO user_sessions (user_id, portal_id, token, expires_at)
                 VALUES ($1, $2, $3, $4)`,
                [user.id, portalId, sessionToken, expiresAt]
            );
            
            // Update last login
            await pool.query(
                'UPDATE users SET last_login = NOW() WHERE id = $1',
                [user.id]
            );
            
            return {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.full_name,
                    emailVerified: user.email_verified
                },
                portals: portalAccess,
                sessionToken,
                expiresAt
            };
            
        } catch (error) {
            throw error;
        }
    }
    
    // ==================== VERIFY SESSION ====================
    
    /**
     * Verify session token and get user info
     * @param {string} sessionToken 
     */
    async verifySession(sessionToken) {
        try {
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
            
            if (result.rows.length === 0) {
                throw new Error('Invalid session');
            }
            
            const session = result.rows[0];
            
            // Check if session expired
            if (new Date(session.expires_at) < new Date()) {
                throw new Error('Session expired');
            }
            
            // Check if user is active
            if (!session.is_active) {
                throw new Error('Account has been deactivated');
            }
            
            // Update last activity
            await pool.query(
                'UPDATE user_sessions SET last_activity = NOW() WHERE token = $1',
                [sessionToken]
            );
            
            return {
                userId: session.user_id,
                email: session.email,
                fullName: session.full_name,
                portalId: session.portal_id,
                role: session.role
            };
            
        } catch (error) {
            throw error;
        }
    }
    
    // ==================== PASSWORD RESET ====================
    
    /**
     * Request password reset (generates token)
     * @param {string} email 
     */
    async requestPasswordReset(email) {
        try {
            // Check if user exists
            const userResult = await pool.query(
                'SELECT id, email, full_name FROM users WHERE email = $1',
                [email.toLowerCase()]
            );
            
            if (userResult.rows.length === 0) {
                // Don't reveal if email exists for security
                return { success: true };
            }
            
            const user = userResult.rows[0];
            
            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
            
            await pool.query(
                `INSERT INTO password_reset_tokens (user_id, token, expires_at)
                 VALUES ($1, $2, $3)`,
                [user.id, resetToken, expiresAt]
            );
            
            return {
                success: true,
                user,
                resetToken // Send this via email
            };
            
        } catch (error) {
            throw error;
        }
    }
    
    /**
     * Reset password using token
     * @param {string} resetToken 
     * @param {string} newPassword 
     */
    async resetPassword(resetToken, newPassword) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Verify token
            const tokenResult = await client.query(
                `SELECT user_id, expires_at, used
                 FROM password_reset_tokens
                 WHERE token = $1`,
                [resetToken]
            );
            
            if (tokenResult.rows.length === 0) {
                throw new Error('Invalid reset token');
            }
            
            const token = tokenResult.rows[0];
            
            if (token.used) {
                throw new Error('Reset token has already been used');
            }
            
            if (new Date(token.expires_at) < new Date()) {
                throw new Error('Reset token has expired');
            }
            
            // Hash new password
            const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
            
            // Update password
            await client.query(
                'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
                [passwordHash, token.user_id]
            );
            
            // Mark token as used
            await client.query(
                'UPDATE password_reset_tokens SET used = true WHERE token = $1',
                [resetToken]
            );
            
            // Invalidate all sessions for this user (force re-login)
            await client.query(
                'DELETE FROM user_sessions WHERE user_id = $1',
                [token.user_id]
            );
            
            await client.query('COMMIT');
            
            return { success: true };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    
    // ==================== LOGOUT ====================
    
    /**
     * Logout user (invalidate session)
     * @param {string} sessionToken 
     */
    async logout(sessionToken) {
        try {
            await pool.query(
                'DELETE FROM user_sessions WHERE token = $1',
                [sessionToken]
            );
            
            return { success: true };
            
        } catch (error) {
            throw error;
        }
    }
    
    // ==================== EMAIL VERIFICATION ====================
    
    /**
     * Verify email using verification token
     * @param {string} verificationToken 
     */
    async verifyEmail(verificationToken) {
        try {
            const result = await pool.query(
                `UPDATE users 
                 SET email_verified = true, 
                     verification_token = NULL,
                     verification_token_expires = NULL
                 WHERE verification_token = $1 
                   AND verification_token_expires > NOW()
                   AND email_verified = false
                 RETURNING id, email`,
                [verificationToken]
            );
            
            if (result.rows.length === 0) {
                throw new Error('Invalid or expired verification token');
            }
            
            return { success: true, user: result.rows[0] };
            
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new AuthService();
