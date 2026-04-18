// =====================================================
// SYNCSTATION MAIN SERVER
// HubSpot Property Sync Platform with User Authentication
// =====================================================

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

// Database connection
const pool = require('./src/services/database');

// Authentication routes and middleware
const authRoutes = require('./src/routes/authRoutes');
const { requireAuth, requireRole, optionalAuth } = require('./src/middleware/requireAuth');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Parse cookies
app.use(cookieParser());

// Serve static files from src/public directory
app.use(express.static('src/public'));

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ==================== AUTHENTICATION ROUTES ====================

// User authentication and management API
app.use('/api/auth', authRoutes);
app.use('/api/users', authRoutes);

// ==================== EXISTING SYNCSTATION ROUTES ====================

// Settings page - Protected route (requires login)
app.get('/settings', requireAuth, async (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'src', 'public', 'account.html'));
    } catch (error) {
        console.error('Settings error:', error);
        res.status(500).send('Error loading settings');
    }
});

// Admin portal - Protected route (requires owner/admin role)
app.get('/admin', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'src', 'public', 'admin.html'));
    } catch (error) {
        console.error('Admin error:', error);
        res.status(500).send('Error loading admin');
    }
});

// Admin portals endpoint - Protected (requires admin role)
app.get('/admin/portals', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        // Your existing admin portals logic
        const result = await pool.query(
            'SELECT * FROM portals ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Admin portals error:', error);
        res.status(500).json({ error: 'Failed to fetch portals' });
    }
});

// Webhooks endpoint - Your existing webhook handler
app.post('/webhooks/receive', async (req, res) => {
    try {
        // Your existing webhook processing logic
        console.log('Webhook received:', req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Error processing webhook');
    }
});

// Account tier API - Your existing tier endpoint
app.get('/api/account/tier', async (req, res) => {
    try {
        const portalId = req.query.portal_id;
        
        if (!portalId) {
            return res.status(400).json({ error: 'portal_id is required' });
        }
        
        // Your existing tier logic
        const result = await pool.query(
            'SELECT tier FROM portals WHERE portal_id = $1',
            [portalId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Portal not found' });
        }
        
        res.json({ tier: result.rows[0].tier });
        
    } catch (error) {
        console.error('Tier API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== AUTHENTICATION FRONTEND ROUTES ====================

// Redirect to static HTML files (served by express.static)
app.get('/login', (req, res) => {
    res.redirect('/login.html');
});

app.get('/register', (req, res) => {
    res.redirect('/register.html');
});

app.get('/forgot-password', (req, res) => {
    res.redirect('/forgot-password.html');
});

app.get('/reset-password', (req, res) => {
    res.redirect('/reset-password.html');
});

app.get('/user-management', (req, res) => {
    res.redirect('/user-management.html');
});

// Email verification endpoint (handles link from email)
app.get('/verify-email', (req, res) => {
    const token = req.query.token;
    
    if (!token) {
        return res.status(400).send('Verification token is required');
    }
    
    // Inline verification page with API call
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Email Verification - SyncStation</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                    padding: 40px;
                    border-radius: 12px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 400px;
                }
                h1 { color: #2563eb; margin-bottom: 20px; }
                .spinner { 
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #2563eb;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .success { color: #10b981; font-size: 64px; margin-bottom: 20px; }
                .error { color: #ef4444; font-size: 64px; margin-bottom: 20px; }
                a {
                    display: inline-block;
                    margin-top: 20px;
                    padding: 12px 30px;
                    background: #2563eb;
                    color: white;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 600;
                }
                a:hover {
                    background: #1d4ed8;
                }
                p { color: #6b7280; line-height: 1.6; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>SyncStation</h1>
                <div class="spinner"></div>
                <p>Verifying your email...</p>
            </div>
            <script>
                fetch('/api/auth/verify-email/${token}')
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            document.querySelector('.container').innerHTML = 
                                '<div class="success">✅</div>' +
                                '<h1>Email Verified!</h1>' +
                                '<p>Your email has been verified successfully. You can now login to your account.</p>' +
                                '<a href="/login">Go to Login</a>';
                        } else {
                            throw new Error(data.error || 'Verification failed');
                        }
                    })
                    .catch(error => {
                        document.querySelector('.container').innerHTML = 
                            '<div class="error">❌</div>' +
                            '<h1>Verification Failed</h1>' +
                            '<p>' + error.message + '</p>' +
                            '<p>The verification link may have expired or already been used.</p>' +
                            '<a href="/login">Go to Login</a>';
                    });
            </script>
        </body>
        </html>
    `);
});

// ==================== HEALTH CHECK ====================

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        app: 'SyncStation',
        version: '1.0.0'
    });
});

// ==================== ROOT REDIRECT ====================

app.get('/', (req, res) => {
    res.redirect('/login');
});

// ==================== ERROR HANDLING ====================

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
    console.error('Error:', err);
    
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// ==================== DATABASE CONNECTION TEST ====================

async function testDatabaseConnection() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
        return true;
    } catch (error) {
        console.error('❌ Database connection error:', error);
        return false;
    }
}

// ==================== START SERVER ====================

async function startServer() {
    try {
        // Test database connection
        const dbConnected = await testDatabaseConnection();
        
        if (!dbConnected) {
            console.error('⚠️  Starting server without database connection');
        }
        
        // Start listening
        app.listen(PORT, '0.0.0.0', () => {
            console.log('');
            console.log('🚀 SyncStation Server Started!');
            console.log('================================');
            console.log(`📡 Server: http://localhost:${PORT}`);
            console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
            console.log(`🔐 Login: https://syncstation.app/login`);
            console.log(`📝 Register: https://syncstation.app/register`);
            console.log(`⚙️  Settings: https://syncstation.app/settings`);
            console.log(`👑 Admin: https://syncstation.app/admin`);
            console.log(`👥 User Mgmt: https://syncstation.app/user-management`);
            console.log('================================');
            console.log('');
        });
        
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
