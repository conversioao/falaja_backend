
import { query } from './db.js';

const sql = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
`;

async function runMigration() {
    console.log('Running migration: adding password_hash column...');
    try {
        await query(sql);
        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
