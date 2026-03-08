import { query } from './db.js';

const sql = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS workflow_id TEXT;
`;

async function runMigration() {
    console.log('Running migration: adding missing columns (role, workflow_id)...');
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
