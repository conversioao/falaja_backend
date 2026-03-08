import { query } from './db.js';

async function fixUsedMinutes() {
    console.log('--- Iniciando Correção de Valores NULL ---');

    try {
        // Update used_minutes to 0 where it is NULL
        console.log('Atualizando used_minutes NULL para 0...');
        const resUsed = await query('UPDATE users SET used_minutes = 0 WHERE used_minutes IS NULL');
        console.log(`Sucesso: ${resUsed.rowCount} usuários atualizados.`);

        // Update credits to 0 where it is NULL (safety check)
        console.log('Atualizando credits NULL para 0...');
        const resCredits = await query('UPDATE users SET credits = 0 WHERE credits IS NULL');
        console.log(`Sucesso: ${resCredits.rowCount} usuários atualizados.`);

        console.log('--- Correção concluída com sucesso! ---');
        process.exit(0);
    } catch (error) {
        console.error('--- ERRO DURANTE A CORREÇÃO ---');
        console.error(error);
        process.exit(1);
    }
}

fixUsedMinutes();
