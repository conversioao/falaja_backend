
import { query } from './db.js';

async function verifyTables() {
    console.log('Verifying tables...');
    try {
        const res = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log('Tables found:');
        res.rows.forEach(r => console.log(`- ${r.table_name}`));
        process.exit(0);
    } catch (error) {
        console.error('Failed to verify tables:', error);
        process.exit(1);
    }
}

verifyTables();
