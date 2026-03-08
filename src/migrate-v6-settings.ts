import { query } from './db.js';

async function runMigration() {
    console.log('Starting migration: creating "global_settings" table...');
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS global_settings (
                id SERIAL PRIMARY KEY,
                n8n_api_url TEXT,
                n8n_workflow_id TEXT,
                n8n_webhook_url TEXT,
                storage_path TEXT,
                payment_webhook_url TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Table "global_settings" created/verified.');

        // Insert default row if not exists
        const checkResult = await query('SELECT id FROM global_settings WHERE id = 1');
        if (checkResult.rows.length === 0) {
            await query(`
                INSERT INTO global_settings (id, n8n_api_url, n8n_workflow_id, n8n_webhook_url, storage_path, payment_webhook_url)
                VALUES (1, '', '', '', '', '')
            `);
            console.log('Default settings row initialized.');
        } else {
            console.log('Settings row already exists.');
        }

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

runMigration();
