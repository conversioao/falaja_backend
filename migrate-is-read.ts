import { query } from './db.js';

async function migrate() {
    try {
        console.log('Adding is_read column to recordings table...');
        await query('ALTER TABLE recordings ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT true');
        console.log('Migration successful!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
