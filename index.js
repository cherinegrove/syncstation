const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');
const session      = require('express-session');

const pool            = require('./src/services/database');
const authRoutes      = require('./src/routes/authRoutes');
const { requireAuth } = require('./src/middleware/requireAuth');
const adminAuthRoutes = require('./src/routes/admin-auth');
const adminRoutes     = require('./src/routes/admin');

// Existing SyncStation routes
const oauthRoutes    = require('./src/routes/oauth');
const settingsRoutes = require('./src/routes/settings');
const actionRoutes   = require('./src/routes/action');
const webhookRoutes  = require('./src/routes/webhooks');
const notifRoutes    = require('./src/routes/notifications');
const accountRoutes  = require('./src/routes/account');

const app  = express();
const PORT = process.env.PORT || 3000;

// Required for Railway reverse proxy
app.set('trust proxy', 1);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
    secret:            process.env.SESSION_SECRET || 'syncstation-secret-change-this',
    resave:            false,
    saveUninitialized: false,
    cookie: {
        secure:   process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge:   24 * 60 * 60 * 1000
    }
}));

app.use(express.static('src/public'));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────

app.use('/admin/auth', adminAuthRoutes);
app.use('/admin/api',  adminRoutes);

// ── CLIENT AUTH ROUTES ────────────────────────────────────────────────────────

app.use('/api/auth',  authRoutes);
app.use('/api/users', authRoutes);

// ── EXISTING SYNCSTATION ROUTES ───────────────────────────────────────────────

app.use('/oauth',         oauthRoutes);
app.use('/settings',      settingsRoutes);
app.use('/action',        actionRoutes);
app.use('/webhooks',      webhookRoutes);
app.use('/notifications', notifRoutes);
app.use('/account',       accountRoutes);

// ── PAGE ROUTES ───────────────────────────────────────────────────────────────

app.get('/settings', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'settings.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'admin.html'));
});

// Serve HTML pages directly (not as redirects to .html — avoids static file conflicts)
app.get('/login',           (req, res) => res.sendFile(path.join(__dirname, 'src', 'public', 'login.html')));
app.get('/register',        (req, res) => res.sendFile(path.join(__dirname, 'src', 'public', 'register.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'src', 'public', 'forgot-password.html')));
app.get('/reset-password',  (req, res) => res.sendFile(path.join(__dirname, 'src', 'public', 'reset-password.html')));
app.get('/user-management', (req, res) => res.sendFile(path.join(__dirname, 'src', 'public', 'user-management.html')));

// Email verification page
app.get('/verify-email', (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(400).send('Verification token is required');
    res.send(`<!DOCTYPE html>
<html><head><title>Email Verification - SyncStation</title>
<style>
  body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea,#764ba2)}
  .box{background:white;padding:40px;border-radius:12px;text-align:center;max-width:400px}
  h1{color:#2563eb}
  .spinner{border:4px solid #f3f3f3;border-top:4px solid #2563eb;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:20px auto}
  @keyframes spin{to{transform:rotate(360deg)}}
  a{display:inline-block;margin-top:20px;padding:12px 30px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:600}
</style></head>
<body><div class="box"><h1>SyncStation</h1><div class="spinner"></div><p>Verifying your email...</p></div>
<script>
  fetch('/api/auth/verify-email?token=${token}').then(r=>r.json()).then(data=>{
    if(data.success){document.querySelector('.box').innerHTML='<div style="font-size:64px;color:#10b981">&#x2705;</div><h1>Email Verified!</h1><p>Your email has been verified. You can now log in.</p><a href="/login">Go to Login</a>';}
    else throw new Error(data.error||'Verification failed');
  }).catch(err=>{document.querySelector('.box').innerHTML='<div style="font-size:64px;color:#ef4444">&#x274c;</div><h1>Verification Failed</h1><p>'+err.message+'</p><a href="/login">Go to Login</a>';});
</script></body></html>`);
});

// ── HEALTH & ROOT ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), app: 'SyncStation' });
});

app.get('/', (req, res) => res.redirect('/login'));

// ── ERROR HANDLING ────────────────────────────────────────────────────────────

app.use((req, res) => res.status(404).json({ error: 'Not Found', path: req.path }));

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ── START ─────────────────────────────────────────────────────────────────────

async function startServer() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
    } catch (err) {
        console.error('⚠️  Database connection error:', err.message);
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 SyncStation running on port ${PORT}`);
        console.log(`🔐 Login:       https://portal.syncstation.app/login`);
        console.log(`⚙️  Settings:    https://portal.syncstation.app/settings`);
        console.log(`🔧 Admin:       https://portal.syncstation.app/admin/auth/login\n`);
    });
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));

startServer();
module.exports = app;
