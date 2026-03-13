import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });
const isProduction = process.env.NODE_ENV === 'production';
const dbHost = process.env.DB_HOST || (isProduction ? '89.167.111.220' : 'localhost');
console.log(`[Database] Connecting to host: ${dbHost} (${isProduction ? 'Production' : 'Development'})`);
const pool = new Pool({
    host: dbHost,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: false // Server does not support SSL
});
export const query = async (text, params) => {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        // console.log('executed query', { text, duration, rows: res.rowCount });
        return res;
    }
    catch (error) {
        console.error('Error executing query', { text, error });
        throw error;
    }
};
export const getClient = async () => {
    const client = await pool.connect();
    return client;
};
