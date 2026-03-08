import { query } from './db.js';

async function fixTransactionsTable() {
    console.log('Starting migration: adding "type" column to transactions table...');
    try {
        // Check if column exists
        const checkResult = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'type';
        `);

        if (checkResult.rows.length === 0) {
            await query('ALTER TABLE transactions ADD COLUMN type VARCHAR(50) DEFAULT \'plan_upgrade\';');
            console.log('Column "type" added successfully.');
        } else {
            console.log('Column "type" already exists.');
        }

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

fixTransactionsTable();
