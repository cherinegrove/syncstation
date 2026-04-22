// =====================================================
// AUTHENTICATION & USER MANAGEMENT ROUTES
// =====================================================

const express = require('express');
const router  = express.Router();
const authService            = require('../services/authService');
const userManagementService  = require('../services/userManagementService');
const emailService           = require('../services/emailService_auth');

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '') ||
                             req.cookies?.sessionToken;
        if (!sessionToken) return res.status(401).json({ error: 'Authentication required' });
        const session = await authService.verifySession(sessionToken);
        req.user = session;
        next();
    } catch (err) {
        return res.status(401).json({ error: err.message });
    }
}

function requirePortalRole(requiredRole = 'user') {
    return async (req, res, next) => {
        try {
            const portalId = req.params.portalId || req.body.portalId || req.user.portalId;
            if (!portalId) return res.status(400).json({ error: 'Portal ID required' });

            const hasPermission = await userManagementService.checkPermission(
                req.user.userId, portalId, requiredRole
            );
            if (!hasPermission) return res.status(403).json({ error: `${requiredRole} access required` });

            req.portalId = portalId;
            next();
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    };
}

// ── PUBLIC ROUTES ─────────────────────────────────────────────────────────────

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName, portalId } = req.body;
        if (!email || !password || !fullName || !portalId) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const existingUsers = await userManagementService.getPortalUsers(portalId);
        const hasOwner      = existingUsers.some(u => u.role === 'owner');
        if (hasOwner) {
            return res.status(400).json({ error: 'This portal already has an owner. Please contact them for access.' });
        }

        const result = await authService.registerUser(email, password, fullName, portalId, 'owner');

        try {
            await emailService.sendVerificationEmail(result.user.email, result.user.full_name, result.verificationToken);
        } catch (e) {
            console.error('Failed to send verification email:', e.message);
        }

        res.json({
            success: true,
            message: 'Registration successful. Please check your email to verify your account.',
            user: result.user
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(400).json({ error: err.message });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password, portalId } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

        const result = await authService.login(email, password, portalId);

        res.cookie('sessionToken', result.sessionToken, {
            httpOnly: true,
            secure:   process.env.NODE_ENV === 'production',
            maxAge:   7 * 24 * 60 * 60 * 1000,
            sameSite: 'strict'
        });

        res.json({
            success:      true,
            user:         result.user,
            portals:      result.portals,
            sessionToken: result.sessionToken
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(401).json({ error: err.message });
    }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.sessionToken;
        await authService.logout(sessionToken);
        res.clearCookie('sessionToken');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const result = await authService.requestPasswordReset(email);

        if (result.user) {
            try {
                await emailService.sendPasswordResetEmail(result.user.email, result.user.full_name, result.resetToken);
            } catch (e) {
                console.error('Failed to send reset email:', e.message);
            }
        }

        res.json({ success: true, message: 'If an account exists with this email, a password reset link has been sent.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
        if (newPassword.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' });

        await authService.resetPassword(token, newPassword);
        res.json({ success: true, message: 'Password reset successfully.' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', async (req, res) => {
    try {
        await authService.verifyEmail(req.params.token);
        res.json({ success: true, message: 'Email verified successfully!' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ── PROTECTED ROUTES ──────────────────────────────────────────────────────────

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
    try {
        const portals = await userManagementService.getUserPortals(req.user.userId);
        res.json({ user: req.user, portals });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/users/portal/:portalId
router.get('/portal/:portalId', requireAuth, requirePortalRole('user'), async (req, res) => {
    try {
        const users = await userManagementService.getPortalUsers(req.portalId);
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users/invite
router.post('/invite', requireAuth, requirePortalRole('admin'), async (req, res) => {
    try {
        const { email, fullName, portalId, role } = req.body;
        if (!email || !fullName || !portalId || !role) return res.status(400).json({ error: 'All fields are required' });
        if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

        const result = await userManagementService.inviteUser(email, fullName, portalId, role, req.user.userId);

        try {
            if (result.isNewUser) {
                await emailService.sendInvitationEmail(email, fullName, req.user.fullName, portalId, result.tempPassword, result.verificationToken);
            } else {
                await emailService.sendPortalAccessEmail(email, fullName, req.user.fullName, portalId, role);
            }
        } catch (e) {
            console.error('Failed to send invitation email:', e.message);
        }

        res.json({ success: true, message: result.isNewUser ? 'User invited successfully.' : 'User added to portal.', userId: result.userId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT /api/users/:userId/role
router.put('/:userId/role', requireAuth, requirePortalRole('owner'), async (req, res) => {
    try {
        const { portalId, role } = req.body;
        if (!portalId || !role) return res.status(400).json({ error: 'Portal ID and role are required' });
        if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

        await userManagementService.updateUserRole(parseInt(req.params.userId), portalId, role, req.user.userId);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/users/:userId
router.delete('/:userId', requireAuth, requirePortalRole('admin'), async (req, res) => {
    try {
        const { portalId } = req.body;
        if (!portalId) return res.status(400).json({ error: 'Portal ID is required' });

        await userManagementService.removeUser(parseInt(req.params.userId), portalId, req.user.userId);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ── PORTAL CONNECTED CHECK ────────────────────────────────────────────────────

// GET /api/portal/connected?portalId=xxx
// Used by settings.html to check if HubSpot OAuth token exists
router.get('/portal/connected', async (req, res) => {
    try {
        const { portalId } = req.query;
        if (!portalId) return res.status(400).json({ error: 'portalId required' });

        const tokenStore = require('../services/tokenStore');
        const token      = await tokenStore.get(portalId);

        res.json({ connected: !!(token && token.access_token) });
    } catch (err) {
        res.json({ connected: false });
    }
});

module.exports = router;
