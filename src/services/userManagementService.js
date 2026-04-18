// =====================================================
// USER MANAGEMENT SERVICE
// Add, remove, update users in portals
// =====================================================

const pool = require('./database');
const authService = require('./authService');

class UserManagementService {
    // ==================== GET PORTAL USERS ====================
    
    /**
     * Get all users for a portal
     * @param {string} portalId 
     */
    async getPortalUsers(portalId) {
        try {
            const result = await pool.query(
                `SELECT 
                    u.id,
                    u.email,
                    u.full_name,
                    u.last_login,
                    u.email_verified,
                    u.is_active as user_active,
                    pu.role,
                    pu.invited_at,
                    pu.accepted_at,
                    pu.is_active as portal_active,
                    inviter.full_name as invited_by_name
                 FROM portal_users pu
                 JOIN users u ON u.id = pu.user_id
                 LEFT JOIN users inviter ON inviter.id = pu.invited_by
                 WHERE pu.portal_id = $1
                 ORDER BY pu.role DESC, u.full_name ASC`,
                [portalId]
            );
            
            return result.rows;
            
        } catch (error) {
            throw error;
        }
    }
    
    // ==================== INVITE USER TO PORTAL ====================
    
    /**
     * Invite a user to a portal (creates user if doesn't exist)
     * @param {string} email 
     * @param {string} fullName 
     * @param {string} portalId 
     * @param {string} role - 'admin' or 'user'
     * @param {number} invitedBy - User ID of inviter
     */
    async inviteUser(email, fullName, portalId, role, invitedBy) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Check if requester has permission (must be owner or admin)
            const requesterResult = await client.query(
                `SELECT role FROM portal_users 
                 WHERE user_id = $1 AND portal_id = $2`,
                [invitedBy, portalId]
            );
            
            if (requesterResult.rows.length === 0) {
                throw new Error('You do not have access to this portal');
            }
            
            const requesterRole = requesterResult.rows[0].role;
            if (!['owner', 'admin'].includes(requesterRole)) {
                throw new Error('Only owners and admins can invite users');
            }
            
            // Only owners can invite admins
            if (role === 'admin' && requesterRole !== 'owner') {
                throw new Error('Only owners can invite admin users');
            }
            
            let userId;
            
            // Check if user already exists
            const existingUser = await client.query(
                'SELECT id FROM users WHERE email = $1',
                [email.toLowerCase()]
            );
            
            if (existingUser.rows.length > 0) {
                userId = existingUser.rows[0].id;
                
                // Check if already in this portal
                const existingPortalUser = await client.query(
                    'SELECT id, is_active FROM portal_users WHERE user_id = $1 AND portal_id = $2',
                    [userId, portalId]
                );
                
                if (existingPortalUser.rows.length > 0) {
                    if (existingPortalUser.rows[0].is_active) {
                        throw new Error('User already has access to this portal');
                    } else {
                        // Reactivate existing portal user
                        await client.query(
                            `UPDATE portal_users 
                             SET is_active = true, role = $1, invited_by = $2, invited_at = NOW()
                             WHERE user_id = $3 AND portal_id = $4`,
                            [role, invitedBy, userId, portalId]
                        );
                        
                        await client.query('COMMIT');
                        return { userId, isNewUser: false, reactivated: true };
                    }
                }
                
            } else {
                // Create temporary password (user must reset)
                const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
                
                const registration = await authService.registerUser(
                    email,
                    tempPassword,
                    fullName,
                    portalId,
                    role,
                    invitedBy
                );
                
                userId = registration.user.id;
                
                await client.query('COMMIT');
                return {
                    userId,
                    isNewUser: true,
                    tempPassword,
                    verificationToken: registration.verificationToken
                };
            }
            
            // Add user to portal
            await client.query(
                `INSERT INTO portal_users (user_id, portal_id, role, invited_by)
                 VALUES ($1, $2, $3, $4)`,
                [userId, portalId, role, invitedBy]
            );
            
            await client.query('COMMIT');
            
            return { userId, isNewUser: false };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    
    // ==================== UPDATE USER ROLE ====================
    
    /**
     * Update a user's role in a portal
     * @param {number} userId 
     * @param {string} portalId 
     * @param {string} newRole 
     * @param {number} updatedBy 
     */
    async updateUserRole(userId, portalId, newRole, updatedBy) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Check if requester has permission
            const requesterResult = await client.query(
                `SELECT role FROM portal_users 
                 WHERE user_id = $1 AND portal_id = $2`,
                [updatedBy, portalId]
            );
            
            if (requesterResult.rows.length === 0) {
                throw new Error('You do not have access to this portal');
            }
            
            const requesterRole = requesterResult.rows[0].role;
            
            // Only owners can change roles
            if (requesterRole !== 'owner') {
                throw new Error('Only portal owners can change user roles');
            }
            
            // Can't change owner role (there should only be one)
            const targetUserResult = await client.query(
                `SELECT role FROM portal_users 
                 WHERE user_id = $1 AND portal_id = $2`,
                [userId, portalId]
            );
            
            if (targetUserResult.rows.length === 0) {
                throw new Error('User not found in this portal');
            }
            
            if (targetUserResult.rows[0].role === 'owner') {
                throw new Error('Cannot change owner role');
            }
            
            // Update role
            await client.query(
                `UPDATE portal_users 
                 SET role = $1
                 WHERE user_id = $2 AND portal_id = $3`,
                [newRole, userId, portalId]
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
    
    // ==================== REMOVE USER FROM PORTAL ====================
    
    /**
     * Remove a user from a portal
     * @param {number} userId 
     * @param {string} portalId 
     * @param {number} removedBy 
     */
    async removeUser(userId, portalId, removedBy) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Check if requester has permission
            const requesterResult = await client.query(
                `SELECT role FROM portal_users 
                 WHERE user_id = $1 AND portal_id = $2`,
                [removedBy, portalId]
            );
            
            if (requesterResult.rows.length === 0) {
                throw new Error('You do not have access to this portal');
            }
            
            const requesterRole = requesterResult.rows[0].role;
            if (!['owner', 'admin'].includes(requesterRole)) {
                throw new Error('Only owners and admins can remove users');
            }
            
            // Check target user
            const targetUserResult = await client.query(
                `SELECT role FROM portal_users 
                 WHERE user_id = $1 AND portal_id = $2`,
                [userId, portalId]
            );
            
            if (targetUserResult.rows.length === 0) {
                throw new Error('User not found in this portal');
            }
            
            const targetRole = targetUserResult.rows[0].role;
            
            // Can't remove owner
            if (targetRole === 'owner') {
                throw new Error('Cannot remove portal owner');
            }
            
            // Admins can only remove regular users, not other admins
            if (requesterRole === 'admin' && targetRole === 'admin') {
                throw new Error('Admins cannot remove other admins');
            }
            
            // Deactivate instead of delete (preserve history)
            await client.query(
                `UPDATE portal_users 
                 SET is_active = false
                 WHERE user_id = $1 AND portal_id = $2`,
                [userId, portalId]
            );
            
            // Invalidate all sessions for this user in this portal
            await client.query(
                'DELETE FROM user_sessions WHERE user_id = $1 AND portal_id = $2',
                [userId, portalId]
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
    
    // ==================== GET USER PORTALS ====================
    
    /**
     * Get all portals a user has access to
     * @param {number} userId 
     */
    async getUserPortals(userId) {
        try {
            const result = await pool.query(
                `SELECT 
                    pu.portal_id,
                    pu.role,
                    pu.invited_at,
                    pu.accepted_at,
                    COUNT(DISTINCT pu2.user_id) as total_users
                 FROM portal_users pu
                 LEFT JOIN portal_users pu2 ON pu2.portal_id = pu.portal_id AND pu2.is_active = true
                 WHERE pu.user_id = $1 AND pu.is_active = true
                 GROUP BY pu.portal_id, pu.role, pu.invited_at, pu.accepted_at
                 ORDER BY pu.role DESC, pu.portal_id ASC`,
                [userId]
            );
            
            return result.rows;
            
        } catch (error) {
            throw error;
        }
    }
    
    // ==================== CHECK USER PERMISSION ====================
    
    /**
     * Check if user has specific permission in portal
     * @param {number} userId 
     * @param {string} portalId 
     * @param {string} requiredRole - 'owner', 'admin', or 'user'
     */
    async checkPermission(userId, portalId, requiredRole = 'user') {
        try {
            const result = await pool.query(
                `SELECT role FROM portal_users 
                 WHERE user_id = $1 AND portal_id = $2 AND is_active = true`,
                [userId, portalId]
            );
            
            if (result.rows.length === 0) {
                return false;
            }
            
            const userRole = result.rows[0].role;
            
            // Role hierarchy: owner > admin > user
            const roleHierarchy = { owner: 3, admin: 2, user: 1 };
            
            return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
            
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new UserManagementService();
