
import { query } from './db.js';

async function createRecordingsTable() {
    console.log('Creating recordings table...');
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS recordings (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                duration TEXT,
                duration_sec INTEGER,
                status TEXT DEFAULT 'completed',
                type TEXT,
                transcription TEXT,
                summary TEXT,
                action_items TEXT[],
                audio_url TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Recordings table created successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to create recordings table:', error);
        process.exit(1);
    }
}

createRecordingsTable();
