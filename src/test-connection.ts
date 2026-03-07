
import { getClient, query } from './db.js';

async function testConnection() {
    console.log('Testing database connection...');
    try {
        const client = await getClient();
        console.log('Successfully connected to the database!');

        console.log('Running test query...');
        const res = await query('SELECT NOW()');
        console.log('Query successful:', res.rows[0]);

        client.release();
        process.exit(0);
    } catch (error) {
        console.error('Failed to connect to the database:', error);
        process.exit(1);
    }
}

testConnection();
