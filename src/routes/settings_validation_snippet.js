// src/routes/settings.js - ADD THIS NEW ENDPOINT

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { getClient } = require('../services/hubspotClient');
const { validateSyncRule } = require('../services/syncService');

// ... (keep all existing routes) ...

// NEW ENDPOINT: Validate sync rule before saving
router.post('/validate', async (req, res) => {
  const { portalId, sourceObject, targetObject, mappings } = req.body;

  if (!portalId || !sourceObject || !targetObject) {
    return res.status(400).json({ 
      valid: false, 
      error: 'Missing required fields' 
    });
  }

  try {
    const client = await getClient(portalId);
    const validation = await validateSyncRule(client, sourceObject, targetObject, mappings);
    
    res.json(validation);
  } catch (err) {
    console.error('[Settings] Validation error:', err.message);
    res.status(500).json({ 
      valid: false, 
      error: 'Validation failed',
      message: err.message 
    });
  }
});

module.exports = router;
