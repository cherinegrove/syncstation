// index.js - Main application file for SyncStation
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// ============================================
// MIDDLEWARE
// ============================================

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (serves files from /src/public)
app.use(express.static(path.join(__dirname, 'src/public')));

// ============================================
// SESSION MIDDLEWARE (MUST BE BEFORE ROUTES)
// ============================================
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'CHANGE-THIS-IN-PRODUCTION-USE-RANDOM-STRING',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
    secure: false // Set to false for now to debug
  },
  name: 'syncstation.sid' // Custom cookie name
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ============================================
// ROUTES
// ============================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Admin authentication routes (NEW - must be before /admin)
app.use('/admin/auth', require('./src/routes/admin-auth'));

// Admin portal routes (UPDATED - now uses session auth)
app.use('/admin', require('./src/routes/admin'));

// API routes (add your existing routes here)
app.use('/api/account', require('./src/routes/account'));
app.use('/api/action', require('./src/routes/action'));
app.use('/api/crmcard', require('./src/routes/crmcard'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/oauth', require('./src/routes/oauth'));
app.use('/api/paystack', require('./src/routes/paystack'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/stripe', require('./src/routes/stripe'));
app.use('/api/webhooks', require('./src/routes/webhooks'));

// Settings API at /settings (backward compatibility)
app.use('/settings', require('./src/routes/settings'));

// Account page route (for portal users)
app.get('/account', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/account.html'));
});

// Root route - redirect to account page or info page
app.get('/', (req, res) => {
  res.redirect('/account.html');
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    path: req.path,
    message: 'The requested resource does not exist'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('');
  console.log('━'.repeat(50));
  console.log('🚀 SyncStation Server Running');
  console.log('━'.repeat(50));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Admin Portal: http://localhost:${PORT}/admin`);
  console.log(`🔐 Admin Login: http://localhost:${PORT}/admin/auth/login`);
  console.log('━'.repeat(50));
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server...');
  pool.end(() => {
    console.log('✅ Database pool closed');
    process.exit(0);
  });
});
