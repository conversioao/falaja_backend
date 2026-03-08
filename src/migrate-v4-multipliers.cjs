const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: false
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migration v4: transcription_modes table...');

        await client.query('BEGIN');

        // Create transcription_modes table
        await client.query(`
            CREATE TABLE IF NOT EXISTS transcription_modes (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                multiplier DECIMAL(5,2) DEFAULT 1.00,
                description TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert initial modes
        const modes = [
            { name: 'Transcrição Padrão', multiplier: 1.0, description: 'Texto fiel ao áudio.' },
            { name: 'Resumo Inteligente', multiplier: 1.5, description: 'Transcrição + resumo estruturado.' },
            { name: 'Ata de Reunião', multiplier: 2.0, description: 'Participantes, decisões, ações.' },
            { name: 'Relatório Profissional', multiplier: 2.0, description: 'Estrutura formal completa.' },
            { name: 'E-mail Profissional', multiplier: 1.5, description: 'Formato de e-mail pronto.' },
            { name: 'Redes Sociais', multiplier: 1.5, description: 'Adaptado para posts.' },
            { name: 'Lista de Tarefas', multiplier: 1.2, description: 'Bullet points de ações.' },
            { name: 'Nota Jurídica', multiplier: 2.5, description: 'Linguagem formal técnica.' },
            { name: 'Resumo Acadêmico', multiplier: 2.0, description: 'Linguagem formal estruturada.' },
            { name: 'Correção Gramatical', multiplier: 1.2, description: 'Texto revisado e otimizado.' }
        ];

        for (const mode of modes) {
            await client.query(
                'INSERT INTO transcription_modes (name, multiplier, description) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET multiplier = $2, description = $3',
                [mode.name, mode.multiplier, mode.description]
            );
        }

        await client.query('COMMIT');
        console.log('Migration v4 completed successfully!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
