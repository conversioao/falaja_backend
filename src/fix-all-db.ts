import { query } from './db.js';

async function fixDatabase() {
    console.log('--- Iniciando Correção da Base de Dados ---');

    try {
        // 1. Garantir que a tabela users tem todas as colunas necessárias
        console.log('Verificando colunas na tabela users...');

        const userColumns = [
            { name: 'whatsapp', type: 'TEXT' },
            { name: 'password_hash', type: 'TEXT' },
            { name: 'role', type: 'TEXT DEFAULT \'user\'' },
            { name: 'app_mode', type: 'TEXT DEFAULT \'professional\'' },
            { name: 'is_verified', type: 'BOOLEAN DEFAULT false' },
            { name: 'verification_code', type: 'TEXT' },
            { name: 'verification_attempts', type: 'INTEGER DEFAULT 0' },
            { name: 'is_blocked', type: 'BOOLEAN DEFAULT false' },
            { name: 'last_active_at', type: 'TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP' }
        ];

        for (const col of userColumns) {
            console.log(`Garantindo coluna: ${col.name}`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        }

        // 2. Garantir que a tabela global_settings existe
        console.log('Verificando tabela global_settings...');
        await query(`
            CREATE TABLE IF NOT EXISTS global_settings (
                id SERIAL PRIMARY KEY,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                description TEXT,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 3. Verificar/Inserir welcome_bonus
        console.log('Verificando welcome_bonus nas definições globais...');
        const bonusCheck = await query("SELECT * FROM global_settings WHERE setting_key = 'welcome_bonus'");
        if (bonusCheck.rows.length === 0) {
            console.log('Inserindo welcome_bonus padrão (10 minutos)...');
            await query(
                "INSERT INTO global_settings (setting_key, setting_value, description) VALUES ($1, $2, $3)",
                ['welcome_bonus', '10', 'Bônus de boas-vindas em minutos após registo']
            );
        } else {
            console.log(`welcome_bonus atual: ${bonusCheck.rows[0].setting_value} minutos.`);
        }

        // 4. Garantir que outras tabelas necessárias existem
        console.log('Garantindo tabelas adicionais...');
        await query(`
            CREATE TABLE IF NOT EXISTS plans (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                price_kz DECIMAL(10,2),
                minutes INTEGER,
                features TEXT[],
                is_popular BOOLEAN DEFAULT false
            );

            CREATE TABLE IF NOT EXISTS transcription_modes (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                multiplier DECIMAL(3,2) DEFAULT 1.0,
                description TEXT
            );
        `);

        console.log('--- Correção concluída com sucesso! ---');
        process.exit(0);
    } catch (error) {
        console.error('--- ERRO DURANTE A CORREÇÃO ---');
        console.error(error);
        process.exit(1);
    }
}

fixDatabase();
