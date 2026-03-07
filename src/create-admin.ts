import { query } from './db.js';
import bcrypt from 'bcryptjs';

async function createAdmin() {
    const email = 'admin@falaja.ao';
    const password = 'adminpassword2026';
    const name = 'Admin Master';

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        // Verifica se admin@falaja.ao já existe
        const res = await query('SELECT id FROM users WHERE email = $1', [email]);

        if (res.rows.length > 0) {
            console.log(`O utilizador ${email} já existe. Atualizando para admin e definindo senha...`);
            await query('UPDATE users SET role = $1, password_hash = $2 WHERE email = $3', ['admin', hashedPassword, email]);
        } else {
            console.log(`Criando novo administrador: ${email}`);
            await query(
                'INSERT INTO users (name, email, password_hash, plan, credits, role) VALUES ($1, $2, $3, $4, $5, $6)',
                [name, email, hashedPassword, 'Enterprise', 1000, 'admin']
            );
        }

        console.log('--- ADMIN CRIADO COM SUCESSO ---');
        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);
        console.log('--------------------------------');

    } catch (err) {
        console.error('Erro ao adicionar admin:', err);
    } finally {
        process.exit(0);
    }
}

createAdmin();
