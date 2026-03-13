import { query } from './db.js';
const sql = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    whatsapp TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT,
    verification_code TEXT,
    is_verified BOOLEAN DEFAULT false,
    plan TEXT DEFAULT 'Gratuito',
    credits INTEGER DEFAULT 15,
    used_minutes INTEGER DEFAULT 0,
    avatar_url TEXT,
    app_mode TEXT DEFAULT 'professional',
    role TEXT DEFAULT 'user',
    last_active_at TIMESTAMP WITH TIME ZONE,
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
    comprovativo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Global Settings table
CREATE TABLE IF NOT EXISTS global_settings (
    id SERIAL PRIMARY KEY,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Initialize default settings
INSERT INTO global_settings (setting_key, setting_value) 
VALUES ('welcome_bonus', '10')
ON CONFLICT (setting_key) DO NOTHING;

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    price TEXT,
    minutes INTEGER,
    features TEXT[]
);

-- Suggestions table
CREATE TABLE IF NOT EXISTS suggestions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Site Visits table
CREATE TABLE IF NOT EXISTS site_visits (
    id SERIAL PRIMARY KEY,
    date DATE UNIQUE DEFAULT CURRENT_DATE,
    count INTEGER DEFAULT 1
);
`;
async function setup() {
    console.log('Iniciando configuração do banco de dados de produção...');
    try {
        await query(sql);
        console.log('✅ Tabelas criadas/verificadas com sucesso!');
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Erro ao configurar banco de dados:', error);
        process.exit(1);
    }
}
setup();
