import { query } from './db.js';

async function mapPackages() {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS credit_packages (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                price_kz INTEGER NOT NULL,
                minutes INTEGER NOT NULL,
                is_active BOOLEAN DEFAULT true
            );
        `);
        console.log("Table created.");

        await query(`
            INSERT INTO credit_packages (name, price_kz, minutes, is_active) 
            SELECT 'Pacote Básico', 5000, 60, true WHERE NOT EXISTS (SELECT 1 FROM credit_packages WHERE name='Pacote Básico');
        `);

        await query(`
            INSERT INTO credit_packages (name, price_kz, minutes, is_active) 
            SELECT 'Pacote Pro', 10000, 150, true WHERE NOT EXISTS (SELECT 1 FROM credit_packages WHERE name='Pacote Pro');
        `);

        console.log("Packages inserted.");
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

mapPackages();
