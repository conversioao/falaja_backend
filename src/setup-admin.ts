import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function setupAdmin() {
    const email = process.argv[2];
    if (!email) {
        console.error('Por favor, forneça o email do usuário: npm run setup-admin -- user@example.com');
        process.exit(1);
    }

    try {
        await client.connect();

        // Verifica se o usuário existe
        const res = await client.query('SELECT id, name, role FROM users WHERE email = $1', [email]);

        if (res.rows.length === 0) {
            console.log(`Usuário com email ${email} não encontrado.`);
            console.log('Criando novo usuário admin...');

            // Aqui você deve usar o hash da senha igual ao do api.ts se quiser criar do zero
            // Para simplicidade, vamos apenas sugerir que o usuário se registre primeiro
            console.error('Erro: Por favor, registre este usuário no app primeiro e depois execute este script para promovê-lo a admin.');
            process.exit(1);
        }

        const user = res.rows[0];
        console.log(`Usuário encontrado: ${user.name} (Role atual: ${user.role})`);

        await client.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', user.id]);

        console.log(`Sucesso! O usuário ${email} agora é um administrador.`);

    } catch (err) {
        console.error('Erro ao configurar admin:', err);
    } finally {
        await client.end();
    }
}

setupAdmin();
