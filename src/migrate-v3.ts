
import { query } from './db.js';

async function migrate() {
    console.log('Starting migration to add app_mode and refine schema...');
    try {
        // Add app_mode to users
        await query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS app_mode TEXT DEFAULT 'professional';
        `);
        console.log('✅ Added app_mode column to users.');

        // Ensure recordings table has the right types
        await query(`
            ALTER TABLE recordings 
            ALTER COLUMN status SET DEFAULT 'completed';
        `);
        console.log('✅ Refined recordings status default.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();
