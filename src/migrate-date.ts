
import { query } from './db.js';

async function migrate() {
    console.log('Migrating recordings.date from TEXT to TIMESTAMPTZ...');
    try {
        // First, check if there are any non-valid dates. 
        // We'll just force the cast and handle 'Agora mesmo' or empty strings if any.
        await query(`
            ALTER TABLE recordings 
            ALTER COLUMN date TYPE TIMESTAMP WITH TIME ZONE 
            USING (
                CASE 
                    WHEN date = 'Agora mesmo' THEN NOW()
                    WHEN date IS NULL OR date = '' THEN NOW()
                    ELSE date::TIMESTAMP WITH TIME ZONE 
                END
            );
        `);
        console.log('✅ Migration successful.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();
