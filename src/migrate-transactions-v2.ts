import { query } from './db.js';

async function migrateTransactions() {
    console.log('Starting migration: adding missing columns to transactions table...');
    try {
        // Add plan_name
        const planNameCheck = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'plan_name';
        `);
        if (planNameCheck.rows.length === 0) {
            await query('ALTER TABLE transactions ADD COLUMN plan_name TEXT;');
            console.log('Column "plan_name" added.');
        }

        // Add amount_kz
        const amountKzCheck = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'amount_kz';
        `);
        if (amountKzCheck.rows.length === 0) {
            await query('ALTER TABLE transactions ADD COLUMN amount_kz TEXT;');
            console.log('Column "amount_kz" added.');
        }

        // Add transaction_id
        const transIdCheck = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'transaction_id';
        `);
        if (transIdCheck.rows.length === 0) {
            await query('ALTER TABLE transactions ADD COLUMN transaction_id TEXT UNIQUE;');
            console.log('Column "transaction_id" added.');
        }

        // Add type if missing (re-verifying from fix-transactions.ts)
        const typeCheck = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'type';
        `);
        if (typeCheck.rows.length === 0) {
            await query("ALTER TABLE transactions ADD COLUMN type VARCHAR(50) DEFAULT 'plan_upgrade';");
            console.log('Column "type" added.');
        }

        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

migrateTransactions();
