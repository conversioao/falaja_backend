
import { query } from './db.js';

async function inspectSchema() {
    try {
        console.log('--- Tables ---');
        const tablesResult = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        const tables = tablesResult.rows.map(r => r.table_name);
        console.log(tables);

        for (const table of tables) {
            console.log(`\n--- Schema of ${table} ---`);
            const columnsResult = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1", [table]);
            console.table(columnsResult.rows);
        }
        process.exit(0);
    } catch (error) {
        console.error('Inspection failed:', error);
        process.exit(1);
    }
}

inspectSchema();
