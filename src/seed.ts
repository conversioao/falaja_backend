import { query } from './db.js';
import { hashPassword } from './auth.js';

async function seedDatabase() {
    console.log('Iniciando o seeding de dados de teste...');
    try {
        const passHash = await hashPassword('123456');

        // Cria 1 admin
        const adminRes = await query(
            `INSERT INTO users (name, email, password_hash, role, plan, credits, used_minutes, app_mode) 
             VALUES ('Admin Teste', 'admin@falaja.com', $1, 'admin', 'Business', 500, 10, 'professional')
             ON CONFLICT (email) DO NOTHING RETURNING id`,
            [passHash]
        );

        // Cria 2 usuários normais
        const user1Res = await query(
            `INSERT INTO users (name, email, password_hash, role, plan, credits, used_minutes, app_mode) 
              VALUES ('Joao Silva', 'joao@teste.com', $1, 'user', 'Essencial', 60, 20, 'simple')
              ON CONFLICT (email) DO NOTHING RETURNING id`,
            [passHash]
        );

        const user2Res = await query(
            `INSERT INTO users (name, email, password_hash, role, plan, credits, used_minutes, app_mode) 
              VALUES ('Maria Santos', 'maria@teste.com', $1, 'user', 'Premium', 300, 150, 'professional')
              ON CONFLICT (email) DO NOTHING RETURNING id`,
            [passHash]
        );

        // Fetch user IDs
        const u1 = await query('SELECT id FROM users WHERE email = $1', ['joao@teste.com']);
        const u2 = await query('SELECT id FROM users WHERE email = $1', ['maria@teste.com']);

        const id1 = u1.rows[0]?.id;
        const id2 = u2.rows[0]?.id;

        if (id1 && id2) {
            // Cria algumas gravações
            await query(
                `INSERT INTO recordings (user_id, title, date, duration, duration_sec, status, type, transcription, summary)
                 VALUES ($1, 'Reunião de Vendas', '2026-03-03T10:00:00.000Z', '00:15:30', 930, 'completed', 'standard', 'Transcrição da reunião...', 'Resumo da reunião de vendas.')`,
                [id1]
            );

            await query(
                `INSERT INTO recordings (user_id, title, date, duration, duration_sec, status, type, transcription, summary)
                 VALUES ($1, 'Ideias de Projeto', '2026-03-03T14:00:00.000Z', '00:05:00', 300, 'completed', 'brainstorming', 'Muitas ideias boas...', 'Várias ideias coletadas.')`,
                [id2]
            );

            // Cria algumas transações
            await query(
                `INSERT INTO transactions (user_id, type, plan_name, amount_kz, transaction_id, status)
                 VALUES ($1, 'plan_upgrade', 'Premium', '15000', 'TX12345678', 'approved')`,
                [id2]
            );

            await query(
                `INSERT INTO transactions (user_id, type, plan_name, amount_kz, transaction_id, status)
                 VALUES ($1, 'plan_upgrade', 'Business', '45000', 'TX87654321', 'pending')`,
                [id1]
            );

            console.log('Seed concluído com sucesso! Utilizadores criados (senha para todos: 123456):');
            console.log('- admin@falaja.com (Admin)');
            console.log('- joao@teste.com (User)');
            console.log('- maria@teste.com (User)');
        }

        process.exit(0);
    } catch (e) {
        console.error('Erro no seed:', e);
        process.exit(1);
    }
}

seedDatabase();
