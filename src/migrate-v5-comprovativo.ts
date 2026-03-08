import { query } from './db.js';

async function runMigration() {
    console.log('Starting migration: adding "proof_url" column to transactions table...');
    try {
        // Check if column exists
        const checkResult = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'proof_url';
        `);

        if (checkResult.rows.length === 0) {
            await query('ALTER TABLE transactions ADD COLUMN proof_url TEXT;');
            console.log('Column "proof_url" added successfully.');
        } else {
            console.log('Column "proof_url" already exists.');
        }

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

runMigration();
