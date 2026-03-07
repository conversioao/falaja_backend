
const { Client } = require('pg');
require('dotenv').config({ path: 'mcp-server/.env' });

const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
});

async function run() {
    console.log('Connecting to database...');
    try {
        await client.connect();
        console.log('Connected. Running migration...');

        await client.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS app_mode TEXT DEFAULT 'professional';
        `);
        console.log('✅ Added app_mode column to users.');

        await client.query(`
            ALTER TABLE recordings 
            ALTER COLUMN status SET DEFAULT 'completed';
        `);
        console.log('✅ Refined recordings status default.');

        await client.end();
        console.log('Migration finished successfully.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

run();
