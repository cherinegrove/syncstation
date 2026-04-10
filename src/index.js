// src/index.js
require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/oauth',         require('./routes/oauth'));
app.use('/action',        require('./routes/action'));
app.use('/settings',      require('./routes/settings'));
app.use('/crm-card',      require('./routes/crmcard'));
app.use('/webhooks',      require('./routes/webhooks'));
app.use('/admin',         require('./routes/admin'));
app.use('/account',       require('./routes/account'));
app.use('/notifications', require('./routes/notifications'));
app.use('/paystack',      require('./routes/paystack'));

// Root landing page
app.get('/', (req, res) => {
  res.send(`
    <html><head><title>SyncStation</title>
    <style>body{font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;color:#333}h1{font-size:36px;margin-bottom:8px}p{color:#666;margin-bottom:32px}a{background:#ff6b35;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:500}</style>
    </head><body>
    <h1>⇄ SyncStation</h1>
    <p>Sync property values between associated HubSpot CRM objects.</p>
    <a href="/oauth/install">Install SyncStation</a>
    </body></html>
  `);
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
const BASE = process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN) || 'http://localhost:' + PORT;

app.listen(PORT, () => {
  console.log(`🚀  SyncStation running on port ${PORT}`);
  console.log(`    Install URL:   ${BASE}/oauth/install`);
  console.log(`    Settings URL:  ${BASE}/settings`);
  console.log(`    Account URL:   ${BASE}/account`);
  console.log(`    Admin URL:     ${BASE}/admin`);
  
  // Run automated notification checks every hour
  const { runAutomatedChecks } = require('./services/notificationService');
  setInterval(async () => {
    console.log('[Scheduler] Running automated notification checks...');
    await runAutomatedChecks();
  }, 60 * 60 * 1000); // Every hour
  
  // ========== POLLING FOR LEADS & PROJECTS ==========
  const { runPollingCycle, initPollingTable } = require('./services/pollingService');
  
  // Initialize polling table
  (async () => {
    await initPollingTable();
  })();
  
  // Run polling every 15 minutes for Leads and Projects
  const POLLING_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds
  console.log(`[Polling] Scheduler starting - will poll every 15 minutes`);
  
  // Run first poll after 2 minutes (give app time to fully start)
  setTimeout(() => {
    runPollingCycle();
  }, 2 * 60 * 1000);
  
  // Then run every 15 minutes
  setInterval(() => {
    runPollingCycle();
  }, POLLING_INTERVAL);
});
