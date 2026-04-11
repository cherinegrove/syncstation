// src/routes/admin-auth.js
// Admin authentication routes

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    // Create admin_users table if it doesn't exist
    pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        account_status VARCHAR(50) DEFAULT 'active',
        invite_token VARCHAR(255),
        invite_expires TIMESTAMP,
        reset_token VARCHAR(255),
        reset_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP
      );
    `).catch(err => console.error('[AdminAuth] Table creation error:', err.message));
  }
  return pool;
}

// Check if user is authenticated (middleware)
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
}

// GET /admin/auth/login - Show login page
router.get('/login', (req, res) => {
  // If already logged in, redirect to admin
  if (req.session && req.session.adminId) {
    return res.redirect('/admin');
  }
  res.sendFile(require('path').join(__dirname, '../public/admin-login.html'));
});

// POST /admin/auth/login - Handle login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  const p = getPool();
  
  try {
    const result = await p.query(
      'SELECT * FROM admin_users WHERE username = $1',
      [username.toLowerCase()]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Set session
    req.session.adminId = user.id;
    req.session.adminUsername = user.username;
    
    // Update last login
    await p.query(
      'UPDATE admin_users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );
    
    res.json({ 
      success: true,
      username: user.username
    });
    
  } catch (err) {
    console.error('[AdminAuth] Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/auth/logout - Handle logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /admin/auth/me - Check current session
router.get('/me', requireAuth, async (req, res) => {
  const p = getPool();
  
  try {
    const result = await p.query(
      'SELECT id, username, email, last_login FROM admin_users WHERE id = $1',
      [req.session.adminId]
    );
    
    if (result.rows.length === 0) {
      req.session.destroy();
      return res.status(401).json({ error: 'Session invalid' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[AdminAuth] Session check error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/auth/create-user - Create new admin user with invite
router.post('/create-user', requireAuth, async (req, res) => {
  const { username, email } = req.body;
  
  if (!username || !email) {
    return res.status(400).json({ error: 'Username and email required' });
  }
  
  // Validate email format
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  
  const p = getPool();
  
  try {
    // Generate invite token
    const crypto = require('crypto');
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Create user with temporary hash (will be replaced when they set password)
    const tempHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    
    // Insert user
    const result = await p.query(
      `INSERT INTO admin_users 
       (username, password_hash, email, invite_token, invite_expires, account_status) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, username, email, invite_expires`,
      [username.toLowerCase(), tempHash, email, inviteToken, inviteExpires, 'pending']
    );
    
    const inviteUrl = `${process.env.APP_BASE_URL || 'https://syncstation.app'}/admin/auth/accept-invite?token=${inviteToken}`;
    
    res.json({
      success: true,
      user: result.rows[0],
      inviteUrl: inviteUrl,
      inviteExpires: inviteExpires
    });
    
  } catch (err) {
    if (err.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    console.error('[AdminAuth] Create user error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/auth/change-password - Change password (only if authenticated)
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  
  const p = getPool();
  
  try {
    // Get current user
    const result = await p.query(
      'SELECT * FROM admin_users WHERE id = $1',
      [req.session.adminId]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await p.query(
      'UPDATE admin_users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, req.session.adminId]
    );
    
    res.json({ success: true });
    
  } catch (err) {
    console.error('[AdminAuth] Change password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /admin/auth/users - List all admin users (only if authenticated)
router.get('/users', requireAuth, async (req, res) => {
  const p = getPool();
  
  try {
    const result = await p.query(
      'SELECT id, username, email, created_at, last_login FROM admin_users ORDER BY created_at DESC'
    );
    
    res.json({ users: result.rows });
  } catch (err) {
    console.error('[AdminAuth] List users error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /admin/auth/users/:id - Delete admin user (only if authenticated)
router.delete('/users/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  
  // Can't delete yourself
  if (parseInt(id) === req.session.adminId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  
  const p = getPool();
  
  try {
    await p.query('DELETE FROM admin_users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[AdminAuth] Delete user error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /admin/auth/accept-invite - Show set password page
router.get('/accept-invite', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/admin-set-password.html'));
});

// POST /admin/auth/accept-invite - Accept invite and set password
router.post('/accept-invite', async (req, res) => {
  const { token, password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password required' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  const p = getPool();
  
  try {
    // Find user with this token
    const result = await p.query(
      'SELECT * FROM admin_users WHERE invite_token = $1',
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid invite link' });
    }
    
    const user = result.rows[0];
    
    // Check if token expired
    if (new Date() > new Date(user.invite_expires)) {
      return res.status(400).json({ error: 'Invite link has expired' });
    }
    
    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Update user
    await p.query(
      `UPDATE admin_users 
       SET password_hash = $1, 
           invite_token = NULL, 
           invite_expires = NULL, 
           account_status = $2
       WHERE id = $3`,
      [passwordHash, 'active', user.id]
    );
    
    res.json({ 
      success: true,
      username: user.username
    });
    
  } catch (err) {
    console.error('[AdminAuth] Accept invite error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/auth/forgot-password - Request password reset
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  const p = getPool();
  
  try {
    const result = await p.query(
      'SELECT * FROM admin_users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    // Always return success (don't reveal if email exists)
    if (result.rows.length === 0) {
      return res.json({ 
        success: true,
        message: 'If an account exists with this email, a reset link has been sent'
      });
    }
    
    const user = result.rows[0];
    
    // Generate reset token
    const crypto = require('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    // Save reset token
    await p.query(
      `UPDATE admin_users 
       SET reset_token = $1, reset_expires = $2 
       WHERE id = $3`,
      [resetToken, resetExpires, user.id]
    );
    
    const resetUrl = `${process.env.APP_BASE_URL || 'https://syncstation.app'}/admin/auth/reset-password?token=${resetToken}`;
    
    // Return URL so you can manually share it (in production, send via email)
    res.json({ 
      success: true,
      message: 'Reset link generated',
      resetUrl: resetUrl
    });
    
  } catch (err) {
    console.error('[AdminAuth] Forgot password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /admin/auth/reset-password - Show reset password page
router.get('/reset-password', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/admin-reset-password.html'));
});

// POST /admin/auth/reset-password - Reset password with token
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password required' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  const p = getPool();
  
  try {
    // Find user with this token
    const result = await p.query(
      'SELECT * FROM admin_users WHERE reset_token = $1',
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid reset link' });
    }
    
    const user = result.rows[0];
    
    // Check if token expired
    if (new Date() > new Date(user.reset_expires)) {
      return res.status(400).json({ error: 'Reset link has expired' });
    }
    
    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Update password and clear reset token
    await p.query(
      `UPDATE admin_users 
       SET password_hash = $1, 
           reset_token = NULL, 
           reset_expires = NULL 
       WHERE id = $2`,
      [passwordHash, user.id]
    );
    
    res.json({ success: true });
    
  } catch (err) {
    console.error('[AdminAuth] Reset password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.requireAuth = requireAuth;
