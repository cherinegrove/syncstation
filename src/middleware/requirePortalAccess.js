// src/middleware/requirePortalAccess.js
//
// Ensures a route can only be accessed by users who belong to the portal
// stored in their server session. The portalId always comes from the
// verified session — never from the client request — so URL/localStorage
// manipulation has zero effect.
//
// Usage:
//   const { requirePortalAccess } = require('../middleware/requirePortalAccess');
//   router.get('/rules', requirePortalAccess, async (req, res) => {
//     const portalId = req.portalId; // ← always safe to use
//   });

const authService = require('../services/authService');

async function requirePortalAccess(req, res, next) {
  try {
    // 1. Verify the session token
    const sessionToken = req.cookies?.sessionToken ||
                         req.headers.authorization?.replace('Bearer ', '');

    if (!sessionToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = await authService.verifySession(sessionToken);

    // 2. Session must have an active portal — if null, user needs to select one
    if (!session.portalId) {
      return res.status(403).json({
        error:    'No portal selected',
        code:     'NO_PORTAL_SELECTED',
        redirect: '/select-portal'
      });
    }

    // 3. Attach to request — routes use req.portalId and req.user
    req.user     = session;
    req.userId   = session.userId;
    req.portalId = session.portalId;  // ← authoritative, from server session

    next();

  } catch (err) {
    console.error('[PortalAccess]', err.message);
    res.clearCookie('sessionToken');
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { requirePortalAccess };
