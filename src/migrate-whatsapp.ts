import { query } from './db.js';

async function migrate() {
    try {
        console.log('Starting migration for WhatsApp Authentication...');

        // 1. Add whatsapp column (allow null initially to migrate existing data)
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(50);`);

        // 2. Add verification columns
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(10);`);
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;`);

        // 3. Drop email column (Careful! Might fail if constraints exist, but we will try)
        try {
            await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;`);
            await query(`ALTER TABLE users DROP COLUMN IF NOT EXISTS email;`);
        } catch (e: any) {
            console.warn('Could not drop email column directly (might not exist or has constraints):', e.message);
        }

        // 4. Set generic whatsapp for existing test users (to avoid null errors if we make it unique/not null later)
        await query(`UPDATE users SET whatsapp = '244000000000' || id WHERE whatsapp IS NULL;`);

        // 5. Make whatsapp UNIQUE
        try {
            await query(`ALTER TABLE users ADD CONSTRAINT users_whatsapp_key UNIQUE (whatsapp);`);
        } catch (e: any) {
            console.warn('Could not add unique constraint. Might already exist:', e.message);
        }

        // 6. Create referrals table
        await query(`
            CREATE TABLE IF NOT EXISTS referrals (
                id SERIAL PRIMARY KEY,
                referrer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                referred_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(referred_id)
            );
        `);

        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    }
}

migrate();
