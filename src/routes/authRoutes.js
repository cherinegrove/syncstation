// =====================================================
// AUTHENTICATION & USER MANAGEMENT ROUTES
// API endpoints for login, registration, user management
// =====================================================

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const userManagementService = require('../services/userManagementService');
const emailService = require('../services/emailService');

// ==================== MIDDLEWARE ====================

/**
 * Middleware to verify session token
 */
async function requireAuth(req, res, next) {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '') || 
                           req.cookies?.sessionToken;
        
        if (!sessionToken) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const session = await authService.verifySession(sessionToken);
        req.user = session;
        next();
        
    } catch (error) {
        return res.status(401).json({ error: error.message });
    }
}

/**
 * Middleware to check portal access and role
 */
function requirePortalRole(requiredRole = 'user') {
    return async (req, res, next) => {
        try {
            const portalId = req.params.portalId || req.body.portalId || req.user.portalId;
            
            if (!portalId) {
                return res.status(400).json({ error: 'Portal ID required' });
            }
            
            const hasPermission = await userManagementService.checkPermission(
                req.user.userId,
                portalId,
                requiredRole
            );
            
            if (!hasPermission) {
                return res.status(403).json({ 
                    error: `${requiredRole.charAt(0).toUpperCase() + requiredRole.slice(1)} access required` 
                });
            }
            
            req.portalId = portalId;
            next();
            
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    };
}

// ==================== PUBLIC ROUTES ====================

/**
 * POST /api/auth/register
 * Register first user (portal owner)
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName, portalId } = req.body;
        
        if (!email || !password || !fullName || !portalId) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        // Check if portal already has an owner
        const existingUsers = await userManagementService.getPortalUsers(portalId);
        const hasOwner = existingUsers.some(u => u.role === 'owner');
        
        if (hasOwner) {
            return res.status(400).json({ 
                error: 'This portal already has an owner. Please contact them for access.' 
            });
        }
        
        const result = await authService.registerUser(
            email, 
            password, 
            fullName, 
            portalId, 
            'owner'
        );
        
        // Send verification email
        try {
            await emailService.sendVerificationEmail(
                result.user.email,
                result.user.full_name,
                result.verificationToken
            );
        } catch (emailError) {
            console.error('Failed to send verification email:', emailError);
        }
        
        res.json({
            success: true,
            message: 'Registration successful. Please check your email to verify your account.',
            user: result.user
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/auth/login
 * User login
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password, portalId } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        const result = await authService.login(email, password, portalId);
        
        // Set session cookie
        res.cookie('sessionToken', result.sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            sameSite: 'strict'
        });
        
        res.json({
            success: true,
            user: result.user,
            portals: result.portals,
            sessionToken: result.sessionToken
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ error: error.message });
    }
});

/**
 * POST /api/auth/logout
 * User logout
 */
router.post('/logout', requireAuth, async (req, res) => {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '') || 
                           req.cookies?.sessionToken;
        
        await authService.logout(sessionToken);
        
        res.clearCookie('sessionToken');
        
        res.json({ success: true, message: 'Logged out successfully' });
        
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        const result = await authService.requestPasswordReset(email);
        
        // Send reset email if user exists
        if (result.user) {
            try {
                await emailService.sendPasswordResetEmail(
                    result.user.email,
                    result.user.full_name,
                    result.resetToken
                );
            } catch (emailError) {
                console.error('Failed to send reset email:', emailError);
            }
        }
        
        // Always return success (don't reveal if email exists)
        res.json({
            success: true,
            message: 'If an account exists with this email, a password reset link has been sent.'
        });
        
    } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }
        
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        
        await authService.resetPassword(token, newPassword);
        
        res.json({
            success: true,
            message: 'Password reset successfully. Please login with your new password.'
        });
        
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/auth/verify-email/:token
 * Verify email address
 */
router.get('/verify-email/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        await authService.verifyEmail(token);
        
        res.json({
            success: true,
            message: 'Email verified successfully!'
        });
        
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ==================== PROTECTED ROUTES ====================

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', requireAuth, async (req, res) => {
    try {
        const portals = await userManagementService.getUserPortals(req.user.userId);
        
        res.json({
            user: req.user,
            portals
        });
        
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/users/portal/:portalId
 * Get all users for a portal
 */
router.get('/portal/:portalId', requireAuth, requirePortalRole('user'), async (req, res) => {
    try {
        const users = await userManagementService.getPortalUsers(req.portalId);
        
        res.json({ users });
        
    } catch (error) {
        console.error('Get portal users error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/users/invite
 * Invite a user to portal
 */
router.post('/invite', requireAuth, requirePortalRole('admin'), async (req, res) => {
    try {
        const { email, fullName, portalId, role } = req.body;
        
        if (!email || !fullName || !portalId || !role) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        
        const result = await userManagementService.inviteUser(
            email,
            fullName,
            portalId,
            role,
            req.user.userId
        );
        
        // Send invitation email
        try {
            if (result.isNewUser) {
                await emailService.sendInvitationEmail(
                    email,
                    fullName,
                    req.user.fullName,
                    portalId,
                    result.tempPassword,
                    result.verificationToken
                );
            } else {
                await emailService.sendPortalAccessEmail(
                    email,
                    fullName,
                    req.user.fullName,
                    portalId,
                    role
                );
            }
        } catch (emailError) {
            console.error('Failed to send invitation email:', emailError);
        }
        
        res.json({
            success: true,
            message: result.isNewUser 
                ? 'User invited successfully. They will receive an email with login instructions.'
                : 'User added to portal successfully.',
            userId: result.userId
        });
        
    } catch (error) {
        console.error('Invite user error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/users/:userId/role
 * Update user role
 */
router.put('/:userId/role', requireAuth, requirePortalRole('owner'), async (req, res) => {
    try {
        const { userId } = req.params;
        const { portalId, role } = req.body;
        
        if (!portalId || !role) {
            return res.status(400).json({ error: 'Portal ID and role are required' });
        }
        
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        
        await userManagementService.updateUserRole(
            parseInt(userId),
            portalId,
            role,
            req.user.userId
        );
        
        res.json({
            success: true,
            message: 'User role updated successfully'
        });
        
    } catch (error) {
        console.error('Update user role error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/users/:userId
 * Remove user from portal
 */
router.delete('/:userId', requireAuth, requirePortalRole('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        const { portalId } = req.body;
        
        if (!portalId) {
            return res.status(400).json({ error: 'Portal ID is required' });
        }
        
        await userManagementService.removeUser(
            parseInt(userId),
            portalId,
            req.user.userId
        );
        
        res.json({
            success: true,
            message: 'User removed from portal successfully'
        });
        
    } catch (error) {
        console.error('Remove user error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
