
import { query } from './db.js';

async function inspectSchema() {
    try {
        const res = await query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'recordings';
        `);
        console.log('Recordings Table Schema:');
        console.table(res.rows);
        process.exit(0);
    } catch (err) {
        console.error('Inspection failed:', err);
        process.exit(1);
    }
}

inspectSchema();
