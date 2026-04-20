// create-admin.js
// Run this script to create your first admin user
// Usage: node create-admin.js

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function createAdmin() {
  console.log('\n🔐  Admin User Creator\n');
  console.log('━'.repeat(50));
  
  try {
    // Get database URL
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error('❌ DATABASE_URL environment variable not set');
      console.log('\nSet it with: export DATABASE_URL="your-postgres-url"');
      process.exit(1);
    }
    
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
    
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected\n');
    
    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP
      );
    `);
    
    // Get user input
    const username = await question('Enter username: ');
    if (!username) {
      console.error('❌ Username required');
      process.exit(1);
    }
    
    const email = await question('Enter email (optional): ');
    
    const password = await question('Enter password (min 8 chars): ');
    if (password.length < 8) {
      console.error('❌ Password must be at least 8 characters');
      process.exit(1);
    }
    
    const confirmPassword = await question('Confirm password: ');
    if (password !== confirmPassword) {
      console.error('❌ Passwords do not match');
      process.exit(1);
    }
    
    console.log('\n⏳ Creating admin user...');
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Insert user
    const result = await pool.query(
      'INSERT INTO admin_users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username.toLowerCase(), passwordHash, email || null]
    );
    
    const user = result.rows[0];
    
    console.log('\n✅ Admin user created successfully!\n');
    console.log('━'.repeat(50));
    console.log('ID:      ', user.id);
    console.log('Username:', user.username);
    console.log('Email:   ', user.email || '(none)');
    console.log('Created: ', user.created_at);
    console.log('━'.repeat(50));
    console.log('\n🎉 You can now login at: https://portal.syncstation.app/admin\n');
    
    await pool.end();
    rl.close();
    
  } catch (err) {
    if (err.code === '23505') {
      console.error('\n❌ Username already exists. Choose a different username.\n');
    } else {
      console.error('\n❌ Error:', err.message, '\n');
    }
    rl.close();
    process.exit(1);
  }
}

createAdmin();
