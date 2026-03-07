import { query } from './db.js';

async function migratePlans() {
    try {
        console.log('Criando tabela plans...');
        await query(`
            CREATE TABLE IF NOT EXISTS plans (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                price_kz DECIMAL(15, 2) NOT NULL,
                minutes INTEGER NOT NULL,
                features TEXT[] DEFAULT '{}',
                is_popular BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Verifica se já existem planos
        const res = await query('SELECT COUNT(*) FROM plans');
        if (parseInt(res.rows[0].count) === 0) {
            console.log('Semeando planos iniciais...');
            const plans = [
                ['Essencial', 5000, 60, ['60 minutos/mês', 'Somente Modo Simples', '-Sem Modos Avançados'], false],
                ['Business', 45000, 1200, ['1200 minutos/mês', 'Painel de Time', 'Suporte VIP'], true],
                ['Enterprise', 120000, 4000, ['4000 minutos/mês', 'Infra Dedicada', 'SLA de 99.9%'], false]
            ];

            for (const plan of plans) {
                await query(
                    'INSERT INTO plans (name, price_kz, minutes, features, is_popular) VALUES ($1, $2, $3, $4, $5)',
                    plan
                );
            }
            console.log('Planos semeados com sucesso.');
        } else {
            console.log('Tabela plans já contém dados. Pulando semeadura.');
        }

    } catch (err) {
        console.error('Erro na migração:', err);
    } finally {
        process.exit();
    }
}

migratePlans();
