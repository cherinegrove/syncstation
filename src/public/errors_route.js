// Add to src/routes/settings.js or create new src/routes/errors.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /errors - Fetch recent sync errors for a portal
router.get('/', async (req, res) => {
  const { portalId } = req.query;

  if (!portalId) {
    return res.status(400).json({ error: 'portalId required' });
  }

  try {
    // Get errors from last 7 days, grouped by error_key
    const result = await pool.query(
      `SELECT 
        id,
        rule_name,
        error_type,
        error_message,
        object_type,
        error_count,
        created_at,
        last_seen
       FROM sync_errors
       WHERE portal_id = $1 
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY last_seen DESC
       LIMIT 50`,
      [portalId]
    );

    res.json({ errors: result.rows });
  } catch (err) {
    console.error('[Errors] Fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch errors' });
  }
});

// POST /errors/dismiss/:id - Dismiss a specific error
router.post('/dismiss/:id', async (req, res) => {
  const { id } = req.params;
  const { portalId } = req.body;

  if (!portalId) {
    return res.status(400).json({ error: 'portalId required' });
  }

  try {
    await pool.query(
      'DELETE FROM sync_errors WHERE id = $1 AND portal_id = $2',
      [id, portalId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Errors] Dismiss failed:', err.message);
    res.status(500).json({ error: 'Failed to dismiss error' });
  }
});

// POST /errors/dismiss-all - Dismiss all errors for portal
router.post('/dismiss-all', async (req, res) => {
  const { portalId } = req.body;

  if (!portalId) {
    return res.status(400).json({ error: 'portalId required' });
  }

  try {
    await pool.query(
      'DELETE FROM sync_errors WHERE portal_id = $1',
      [portalId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Errors] Dismiss all failed:', err.message);
    res.status(500).json({ error: 'Failed to dismiss errors' });
  }
});

module.exports = router;
