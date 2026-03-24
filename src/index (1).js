// src/index.js
require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/oauth',    require('./routes/oauth'));
app.use('/action',   require('./routes/action'));
app.use('/settings', require('./routes/settings'));
app.use('/crm-card', require('./routes/crmcard'));
app.use('/webhooks', require('./routes/webhooks'));
app.use('/admin',    require('./routes/admin'));
app.use('/account',  require('./routes/account'));

// Root landing page
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <title>PropBridge</title>
      <style>
        body { font-family: sans-serif; max-width: 600px; margin: 80px auto; text-align: center; color: #333; }
        h1 { font-size: 36px; margin-bottom: 8px; }
        p { color: #666; margin-bottom: 32px; }
        a { background: #ff6b35; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 500; }
        a:hover { background: #ff8555; }
      </style>
    </head>
    <body>
      <h1>⇄ PropBridge</h1>
      <p>Sync property values between associated HubSpot CRM objects.</p>
      <a href="/oauth/install">Install PropBridge</a>
    </body>
    </html>
  `);
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
const BASE = process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN) || 'http://localhost:' + PORT;

app.listen(PORT, () => {
  console.log(`🚀  PropBridge V2 running on port ${PORT}`);
  console.log(`    Install URL:   ${BASE}/oauth/install`);
  console.log(`    Settings URL:  ${BASE}/settings`);
  console.log(`    Account URL:   ${BASE}/account`);
  console.log(`    Admin URL:     ${BASE}/admin`);
});
