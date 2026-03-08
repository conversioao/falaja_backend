import { query } from './db.js';

async function migrate() {
    try {
        console.log('Creating global_settings table...');
        await query(`
            CREATE TABLE IF NOT EXISTS global_settings (
                key VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    }
}

migrate();
