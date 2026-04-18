// =====================================================
// DATABASE CONNECTION SERVICE
// PostgreSQL connection pool
// =====================================================

const { Pool } = require('pg');

// Create connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : false,
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Log connection events
pool.on('connect', () => {
    console.log('✅ Database client connected');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database error:', err);
});

// Test query helper
pool.testConnection = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        return false;
    }
};

module.exports = pool;
