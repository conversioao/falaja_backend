
import { query } from './db.js';

async function migrate() {
    console.log('Starting migration: Payments and Roles...');

    try {
        // 1. Add role column to users if it doesn't exist
        console.log('Adding role column to users...');
        await query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
        `);

        // 2. Create transactions table
        console.log('Creating transactions table...');
        await query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                type TEXT NOT NULL, -- 'credits' or 'plan_upgrade'
                plan_name TEXT, -- 'Premium', 'Business'
                amount_kz TEXT NOT NULL,
                transaction_id TEXT UNIQUE NOT NULL, -- External Trans ID from user
                status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP WITH TIME ZONE,
                reviewer_id INTEGER REFERENCES users(id)
            );
        `);

        // 3. Set an initial admin (optional, for testing)
        // Adjust the email to a user you already registered
        console.log('Setting first admin user...');
        await query(`
            UPDATE users SET role = 'admin' WHERE id = 1;
        `);

        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
