import { query } from './db.js';

async function migrate() {
    try {
        console.log('Starting V7 migrations (Suggestions, Analytics, Online Users, Notify Webhook)...');

        // 1. Add last_active_at to users
        console.log('Adding last_active_at to users...');
        await query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        `);

        // 2. Create suggestions table
        console.log('Creating suggestions table...');
        await query(`
            CREATE TABLE IF NOT EXISTS suggestions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 3. Create site_visits table (daily aggregation)
        console.log('Creating site_visits table...');
        await query(`
            CREATE TABLE IF NOT EXISTS site_visits (
                date DATE PRIMARY KEY,
                count INTEGER DEFAULT 1
            )
        `);

        // 4. Add notify_user_webhook to global_settings
        console.log('Adding notify_user_webhook to global_settings...');
        await query(`
            ALTER TABLE global_settings 
            ADD COLUMN IF NOT EXISTS notify_user_webhook TEXT DEFAULT ''
        `);

        console.log('Migration V7 completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

migrate();
