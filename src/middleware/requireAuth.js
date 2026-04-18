// =====================================================
// AUTHENTICATION MIDDLEWARE
// Protects routes requiring login
// =====================================================

const authService = require('../services/authService');

/**
 * Middleware to require authentication for routes
 * Checks for session token in cookies or Authorization header
 * Redirects to login if not authenticated
 */
async function requireAuth(req, res, next) {
    try {
        // Get session token from cookie or Authorization header
        const sessionToken = req.cookies?.sessionToken || 
                           req.headers.authorization?.replace('Bearer ', '');
        
        if (!sessionToken) {
            // For API routes, return 401
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ 
                    error: 'Authentication required',
                    message: 'Please login to access this resource'
                });
            }
            
            // For page routes, redirect to login
            return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
        }
        
        // Verify session is valid
        const session = await authService.verifySession(sessionToken);
        
        // Attach user info to request
        req.user = session;
        req.userId = session.userId;
        req.userEmail = session.email;
        req.userRole = session.role;
        
        next();
        
    } catch (error) {
        console.error('Auth middleware error:', error);
        
        // Clear invalid session cookie
        res.clearCookie('sessionToken');
        
        // For API routes, return 401
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ 
                error: 'Invalid or expired session',
                message: 'Please login again'
            });
        }
        
        // For page routes, redirect to login
        return res.redirect('/login?expired=true&redirect=' + encodeURIComponent(req.originalUrl));
    }
}

/**
 * Middleware to require specific role
 * Must be used AFTER requireAuth
 * @param {string} requiredRole - 'owner', 'admin', or 'user'
 */
function requireRole(requiredRole = 'user') {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Authentication required' 
            });
        }
        
        // Role hierarchy: owner > admin > user
        const roleHierarchy = { owner: 3, admin: 2, user: 1 };
        const userRoleLevel = roleHierarchy[req.user.role] || 0;
        const requiredRoleLevel = roleHierarchy[requiredRole] || 0;
        
        if (userRoleLevel < requiredRoleLevel) {
            // For API routes, return 403
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ 
                    error: 'Insufficient permissions',
                    message: `${requiredRole} access required`
                });
            }
            
            // For page routes, show error page
            return res.status(403).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Access Denied - SyncStation</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            min-height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .container {
                            background: white;
                            padding: 60px;
                            border-radius: 12px;
                            text-align: center;
                            max-width: 500px;
                        }
                        h1 { color: #ef4444; font-size: 72px; margin: 0; }
                        h2 { color: #374151; margin: 20px 0; }
                        p { color: #6b7280; line-height: 1.6; }
                        a {
                            display: inline-block;
                            margin-top: 30px;
                            padding: 12px 30px;
                            background: #2563eb;
                            color: white;
                            text-decoration: none;
                            border-radius: 8px;
                            font-weight: 600;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>🚫</h1>
                        <h2>Access Denied</h2>
                        <p>You don't have permission to access this page.</p>
                        <p><strong>${requiredRole}</strong> access is required.</p>
                        <a href="/settings">← Back to Settings</a>
                    </div>
                </body>
                </html>
            `);
        }
        
        next();
    };
}

/**
 * Optional authentication
 * Attaches user info if logged in, but doesn't require it
 */
async function optionalAuth(req, res, next) {
    try {
        const sessionToken = req.cookies?.sessionToken || 
                           req.headers.authorization?.replace('Bearer ', '');
        
        if (sessionToken) {
            const session = await authService.verifySession(sessionToken);
            req.user = session;
            req.userId = session.userId;
            req.isAuthenticated = true;
        } else {
            req.isAuthenticated = false;
        }
        
        next();
        
    } catch (error) {
        // If session invalid, just mark as not authenticated
        req.isAuthenticated = false;
        res.clearCookie('sessionToken');
        next();
    }
}

module.exports = {
    requireAuth,
    requireRole,
    optionalAuth
};
