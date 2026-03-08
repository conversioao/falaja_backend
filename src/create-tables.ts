
import { query } from './db.js';

const sql = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    whatsapp TEXT UNIQUE,
    password_hash TEXT,
    phone TEXT,
    plan TEXT DEFAULT 'Gratuito',
    credits INTEGER DEFAULT 10,
    used_minutes INTEGER DEFAULT 0,
    avatar_url TEXT,
    app_mode TEXT DEFAULT 'professional',
    role TEXT DEFAULT 'user',
    is_verified BOOLEAN DEFAULT false,
    verification_code TEXT,
    verification_attempts INTEGER DEFAULT 0,
    is_blocked BOOLEAN DEFAULT false,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Recordings table
CREATE TABLE IF NOT EXISTS recordings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    date TEXT,
    duration TEXT,
    duration_sec INTEGER,
    status TEXT,
    type TEXT,
    transcription TEXT,
    summary TEXT,
    action_items TEXT[],
    audio_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    method TEXT,
    amount TEXT,
    status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Credit History table
CREATE TABLE IF NOT EXISTS credit_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type TEXT,
    description TEXT,
    amount TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
`;

async function createTables() {
    console.log('Creating database tables...');
    try {
        await query(sql);
        console.log('Successfully created all tables!');
        process.exit(0);
    } catch (error) {
        console.error('Failed to create tables:', error);
        process.exit(1);
    }
}

createTables();
