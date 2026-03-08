import { query } from './db.js';

async function migrate() {
    try {
        console.log('Dropping old global_settings table...');
        await query('DROP TABLE IF EXISTS global_settings;');

        console.log('Creating global_settings table with safe column names...');
        await query(`
            CREATE TABLE global_settings (
                setting_key VARCHAR(255) PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    }
}

migrate();
