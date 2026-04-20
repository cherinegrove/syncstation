// =====================================================
// ADMIN SERVICE
// Portal analytics, user stats, and sync monitoring
// =====================================================

const pool = require('./database');

class AdminService {
    // ==================== PORTAL OVERVIEW ====================
    
    /**
     * Get all portals with summary stats
     * Aggregates from ALL sources: portals table, sync_rules, and portal_users
     */
    async getAllPortals() {
        try {
            const query = `
                WITH all_portal_ids AS (
                    -- Get portal IDs from portals table
                    SELECT DISTINCT portal_id FROM portals
                    UNION
                    -- Get portal IDs from sync_rules
                    SELECT DISTINCT portal_id FROM sync_rules
                    UNION
                    -- Get portal IDs from portal_users
                    SELECT DISTINCT portal_id FROM portal_users
                ),
                portal_stats AS (
                    SELECT 
                        api.portal_id,
                        COALESCE(p.tier, 'FREE') as tier,
                        COALESCE(p.created_at, MIN(sr.created_at), MIN(pu.invited_at)) as created_at,
                        p.updated_at,
                        COUNT(DISTINCT pu.user_id) FILTER (WHERE pu.is_active = true) as user_count,
                        COUNT(DISTINCT sr.id) as total_syncs,
                        COUNT(DISTINCT sr.id) FILTER (WHERE sr.is_active = true) as active_syncs,
                        COUNT(DISTINCT sr.id) FILTER (WHERE sr.is_active = false) as inactive_syncs,
                        MAX(sr.last_synced_at) as last_sync_time
                    FROM all_portal_ids api
                    LEFT JOIN portals p ON p.portal_id = api.portal_id
                    LEFT JOIN portal_users pu ON pu.portal_id = api.portal_id
                    LEFT JOIN sync_rules sr ON sr.portal_id = api.portal_id
                    GROUP BY api.portal_id, p.tier, p.created_at, p.updated_at
                )
                SELECT * FROM portal_stats
                ORDER BY created_at DESC NULLS LAST
            `;
            
            const result = await pool.query(query);
            return result.rows;
            
        } catch (error) {
            console.error('Get all portals error:', error);
            throw error;
        }
    }
    
    /**
     * Get detailed portal information
     * @param {string} portalId 
     */
    async getPortalDetails(portalId) {
        try {
            // Get portal basic info
            const portalResult = await pool.query(
                'SELECT * FROM portals WHERE portal_id = $1',
                [portalId]
            );
            
            if (portalResult.rows.length === 0) {
                throw new Error('Portal not found');
            }
            
            const portal = portalResult.rows[0];
            
            // Get users for this portal
            const usersResult = await pool.query(`
                SELECT 
                    u.id,
                    u.email,
                    u.full_name,
                    u.last_login,
                    u.email_verified,
                    u.is_active as user_active,
                    pu.role,
                    pu.invited_at,
                    pu.is_active as portal_active
                FROM portal_users pu
                JOIN users u ON u.id = pu.user_id
                WHERE pu.portal_id = $1
                ORDER BY pu.role DESC, u.full_name ASC
            `, [portalId]);
            
            // Get sync rules for this portal
            const syncRulesResult = await pool.query(`
                SELECT 
                    id,
                    rule_name,
                    source_object,
                    target_object,
                    is_active,
                    created_at,
                    last_synced_at,
                    sync_count
                FROM sync_rules
                WHERE portal_id = $1
                ORDER BY created_at DESC
            `, [portalId]);
            
            // Get recent webhook activity (last 7 days)
            const webhookActivityResult = await pool.query(`
                SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as webhook_count
                FROM webhook_logs
                WHERE portal_id = $1
                  AND created_at > NOW() - INTERVAL '7 days'
                GROUP BY DATE(created_at)
                ORDER BY date DESC
            `, [portalId]);
            
            return {
                portal,
                users: usersResult.rows,
                syncRules: syncRulesResult.rows,
                webhookActivity: webhookActivityResult.rows,
                stats: {
                    totalUsers: usersResult.rows.length,
                    activeUsers: usersResult.rows.filter(u => u.user_active && u.portal_active).length,
                    totalSyncs: syncRulesResult.rows.length,
                    activeSyncs: syncRulesResult.rows.filter(r => r.is_active).length,
                    totalWebhooks: webhookActivityResult.rows.reduce((sum, day) => sum + parseInt(day.webhook_count), 0)
                }
            };
            
        } catch (error) {
            console.error('Get portal details error:', error);
            throw error;
        }
    }
    
    // ==================== USER MANAGEMENT ====================
    
    /**
     * Get all users across all portals
     */
    async getAllUsers() {
        try {
            const result = await pool.query(`
                SELECT 
                    u.id,
                    u.email,
                    u.full_name,
                    u.created_at,
                    u.last_login,
                    u.email_verified,
                    u.is_active,
                    COUNT(DISTINCT pu.portal_id) as portal_count,
                    ARRAY_AGG(DISTINCT pu.portal_id) as portals
                FROM users u
                LEFT JOIN portal_users pu ON pu.user_id = u.id AND pu.is_active = true
                GROUP BY u.id
                ORDER BY u.created_at DESC
            `);
            
            return result.rows;
            
        } catch (error) {
            console.error('Get all users error:', error);
            throw error;
        }
    }
    
    /**
     * Get user details with all portals
     * @param {number} userId 
     */
    async getUserDetails(userId) {
        try {
            const userResult = await pool.query(
                'SELECT * FROM users WHERE id = $1',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const portalsResult = await pool.query(`
                SELECT 
                    pu.portal_id,
                    pu.role,
                    pu.invited_at,
                    pu.is_active,
                    p.tier
                FROM portal_users pu
                LEFT JOIN portals p ON p.portal_id = pu.portal_id
                WHERE pu.user_id = $1
                ORDER BY pu.invited_at DESC
            `, [userId]);
            
            return {
                user: userResult.rows[0],
                portals: portalsResult.rows
            };
            
        } catch (error) {
            console.error('Get user details error:', error);
            throw error;
        }
    }
    
    // ==================== TIER MANAGEMENT ====================
    
    /**
     * Update portal tier
     * @param {string} portalId 
     * @param {string} tier 
     */
    async updatePortalTier(portalId, tier) {
        try {
            const validTiers = ['FREE', 'TRIAL', 'STARTER', 'PRO', 'BUSINESS', 'CANCELLED', 'SUSPENDED'];
            
            if (!validTiers.includes(tier)) {
                throw new Error('Invalid tier');
            }
            
            const result = await pool.query(
                `UPDATE portals 
                 SET tier = $1, updated_at = NOW()
                 WHERE portal_id = $2
                 RETURNING *`,
                [tier, portalId]
            );
            
            if (result.rows.length === 0) {
                throw new Error('Portal not found');
            }
            
            return result.rows[0];
            
        } catch (error) {
            console.error('Update portal tier error:', error);
            throw error;
        }
    }
    
    // ==================== SYNC ANALYTICS ====================
    
    /**
     * Get sync statistics across all portals
     */
    async getSyncStatistics() {
        try {
            const result = await pool.query(`
                SELECT 
                    COUNT(DISTINCT portal_id) as total_portals,
                    COUNT(*) as total_syncs,
                    COUNT(CASE WHEN is_active = true THEN 1 END) as active_syncs,
                    COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_syncs,
                    SUM(sync_count) as total_sync_operations,
                    MAX(last_synced_at) as last_sync_time
                FROM sync_rules
            `);
            
            return result.rows[0];
            
        } catch (error) {
            console.error('Get sync statistics error:', error);
            throw error;
        }
    }
    
    /**
     * Get most active portals by sync count
     * @param {number} limit 
     */
    async getMostActivePortals(limit = 10) {
        try {
            const result = await pool.query(`
                SELECT 
                    p.portal_id,
                    p.tier,
                    COUNT(sr.id) as sync_count,
                    SUM(sr.sync_count) as total_operations,
                    MAX(sr.last_synced_at) as last_sync
                FROM portals p
                LEFT JOIN sync_rules sr ON sr.portal_id = p.portal_id
                GROUP BY p.portal_id, p.tier
                ORDER BY total_operations DESC NULLS LAST
                LIMIT $1
            `, [limit]);
            
            return result.rows;
            
        } catch (error) {
            console.error('Get most active portals error:', error);
            throw error;
        }
    }
    
    // ==================== ACTIVITY LOGS ====================
    
    /**
     * Get recent activity across all portals
     * @param {number} limit 
     */
    async getRecentActivity(limit = 50) {
        try {
            // This assumes you have activity logging tables
            // Adjust based on your actual schema
            const result = await pool.query(`
                SELECT 
                    'sync' as activity_type,
                    portal_id,
                    rule_name as description,
                    last_synced_at as activity_time
                FROM sync_rules
                WHERE last_synced_at IS NOT NULL
                ORDER BY last_synced_at DESC
                LIMIT $1
            `, [limit]);
            
            return result.rows;
            
        } catch (error) {
            console.error('Get recent activity error:', error);
            throw error;
        }
    }
    
    // ==================== DEACTIVATE USER ====================
    
    /**
     * Deactivate a user globally
     * @param {number} userId 
     */
    async deactivateUser(userId) {
        try {
            const result = await pool.query(
                `UPDATE users 
                 SET is_active = false
                 WHERE id = $1
                 RETURNING *`,
                [userId]
            );
            
            if (result.rows.length === 0) {
                throw new Error('User not found');
            }
            
            // Also invalidate all sessions
            await pool.query(
                'DELETE FROM user_sessions WHERE user_id = $1',
                [userId]
            );
            
            return result.rows[0];
            
        } catch (error) {
            console.error('Deactivate user error:', error);
            throw error;
        }
    }
}

module.exports = new AdminService();
