import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query } from './db.js';
import { hashPassword, comparePassword, generateToken, verifyToken } from './auth.js';
import fetch from 'node-fetch';

dotenv.config();

// Disable SSL verification for local development
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Database Schema Migration
async function ensureSchema() {
    console.log('[Migration] Verifying database schema...');
    try {
        const isReadCheck = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings' AND column_name = 'is_read'");
        if (isReadCheck.rows.length === 0) {
            console.log('[Migration] Adding is_read column...');
            await query("ALTER TABLE recordings ADD COLUMN is_read BOOLEAN DEFAULT false");
        }
        const summaryCheck = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings' AND column_name = 'summary'");
        if (summaryCheck.rows.length === 0) {
            console.log('[Migration] Adding summary column...');
            await query("ALTER TABLE recordings ADD COLUMN summary TEXT");
        }
        const actionItemsCheck = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings' AND column_name = 'action_items'");
        if (actionItemsCheck.rows.length === 0) {
            console.log('[Migration] Adding action_items column...');
            await query("ALTER TABLE recordings ADD COLUMN action_items JSONB DEFAULT '[]'");
        }
        await query('UPDATE users SET used_minutes = 0 WHERE used_minutes IS NULL');
        await query('UPDATE users SET credits = 0 WHERE credits IS NULL');
        console.log('[Migration] Schema verified.');
    } catch (err) {
        console.error('[Migration] Error:', err);
    }
}
ensureSchema();

const app = express();
const port = process.env.PORT || 3003;

interface AuthenticatedRequest extends Request {
    userId?: number;
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Invalid token' });
    req.userId = decoded.id;
    next();
};

const requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const result = await query('SELECT role FROM users WHERE id = $1', [req.userId]);
        if (!result.rows[0] || result.rows[0].role !== 'admin') return res.status(403).json({ error: 'Admin required' });
        next();
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// --- ROUTES ---
app.get('/api/health', async (req, res) => {
    try {
        const dbCheck = await query('SELECT NOW()');
        res.json({ status: 'ok', database: 'connected', time: dbCheck.rows[0].now });
    } catch (err: any) {
        res.status(500).json({ status: 'error', database: err.message });
    }
});

app.get('/', (req, res) => {
    res.send('<h1>FalaJá API</h1><p>Backend running.</p>');
});

// --- AUTH ---
const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();

app.post('/api/auth/register', async (req, res) => {
    const { name, whatsapp, password } = req.body;
    try {
        const existing = await query('SELECT id FROM users WHERE whatsapp = $1', [whatsapp]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Usuário existe' });
        const passHash = await hashPassword(password);
        const code = generateVerificationCode();
        const setting = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'welcome_bonus' LIMIT 1");
        const bonus = parseInt(setting.rows[0]?.setting_value || '10');
        await query('INSERT INTO users (name, whatsapp, password_hash, verification_code, is_verified, credits, used_minutes, app_mode, role, plan, email) VALUES ($1, $2, $3, $4, false, $5, 0, $6, $7, $8, $9)', 
            [name, whatsapp, passHash, code, bonus, 'professional', 'user', 'Gratuito', `${whatsapp}@falaja.ao`]);
        res.status(201).json({ needsVerification: true, message: 'Código enviado' });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/auth/verify', async (req, res) => {
    const { whatsapp, code } = req.body;
    try {
        const result = await query('SELECT * FROM users WHERE whatsapp = $1', [whatsapp]);
        const user = result.rows[0];
        if (!user || user.verification_code !== code) return res.status(401).json({ error: 'Código inválido' });
        await query('UPDATE users SET is_verified = true, verification_code = NULL WHERE id = $1', [user.id]);
        const token = generateToken({ id: user.id });
        res.json({ user, token });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { whatsapp, password } = req.body;
    try {
        const result = await query('SELECT * FROM users WHERE whatsapp = $1', [whatsapp]);
        const user = result.rows[0];
        if (!user || !(await comparePassword(password, user.password_hash))) return res.status(401).json({ error: 'Credenciais inválidas' });
        if (!user.is_verified) return res.json({ needsVerification: true, message: 'Verifique WhatsApp' });
        res.json({ user, token: generateToken({ id: user.id }) });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const result = await query('SELECT id, name, email, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", role, app_mode as "appMode" FROM users WHERE id = $1', [req.userId]);
        res.json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

// --- RECORDINGS ---
app.get('/api/recordings', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const result = await query('SELECT id, title, date, duration, duration_sec as "durationSec", status, type, transcription, summary, action_items as "actionItems", audio_url as "audioUrl", COALESCE(is_read, false) as "isRead" FROM recordings WHERE user_id = $1 ORDER BY date DESC', [req.userId]);
        res.json({ recordings: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/transcribe', express.raw({ type: '*/*', limit: '50mb' }), authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const mode = (req.headers['x-mode'] || 'Transcrição Padrão').toString();
        const settings = await query("SELECT setting_key, setting_value FROM global_settings");
        const settingsMap: any = {};
        settings.rows.forEach((r: any) => settingsMap[r.setting_key] = r.setting_value);
        const webhookUrl = mode.toLowerCase().includes('simples') ? settingsMap['n8n_webhook_simple'] : settingsMap['n8n_webhook_url'];
        if (!webhookUrl) return res.status(500).json({ error: 'Webhook error' });

        const userRes = await query('SELECT name, whatsapp, credits FROM users WHERE id = $1', [req.userId]);
        const durationSec = parseInt((req.headers['x-duration-sec'] || '0') as string);
        const recording = await query('INSERT INTO recordings (user_id, title, date, duration, duration_sec, status, type) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6) RETURNING id', [req.userId, `Gravação ${new Date().toLocaleString()}`, req.headers['x-duration'], durationSec, 'processing', mode]);
        
        const callbackUrl = `${process.env.BACKEND_URL || req.protocol + '://' + req.get('host')}/api/webhooks/transcription-complete`;
        fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': req.headers['content-type'] as string, 'X-Recording-Id': recording.rows[0].id.toString(), 'X-Callback-Url': callbackUrl },
            body: req.body
        });
        res.json({ success: true, recordingId: recording.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/webhooks/transcription-complete', async (req, res) => {
    const { recordingId, transcription, summary, actionItems, durationSec, title } = req.body;
    try {
        await query('UPDATE recordings SET transcription = $1, summary = $2, action_items = $3, status = \'completed\', duration_sec = COALESCE($4, duration_sec), title = COALESCE($5, title) WHERE id = $6', [transcription, summary, actionItems, durationSec, title, recordingId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

// --- MISSING PRODUCTION ROUTES ---
app.get('/api/modes', async (req, res) => {
    try {
        const result = await query('SELECT * FROM transcription_modes ORDER BY name ASC');
        res.json({ modes: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.get('/api/plans', async (req, res) => {
    try {
        const result = await query('SELECT * FROM plans ORDER BY price_kz ASC');
        res.json({ plans: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.get('/api/credit-packages', async (req, res) => {
    try {
        const result = await query('SELECT * FROM credit_packages WHERE is_active = true ORDER BY price_kz ASC');
        res.json({ packages: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/modes', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT * FROM transcription_modes ORDER BY id ASC');
        res.json({ modes: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/admin/modes', authenticateToken, requireAdmin, async (req, res) => {
    const { name, multiplier, description } = req.body;
    try {
        const result = await query('INSERT INTO transcription_modes (name, multiplier, description) VALUES ($1, $2, $3) RETURNING *', [name, multiplier, description]);
        res.status(201).json({ mode: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.patch('/api/admin/modes/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, multiplier, description } = req.body;
    try {
        const result = await query('UPDATE transcription_modes SET name = COALESCE($1, name), multiplier = COALESCE($2, multiplier), description = COALESCE($3, description) WHERE id = $4 RETURNING *', [name, multiplier, description, id]);
        res.json({ mode: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.delete('/api/admin/modes/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await query('DELETE FROM transcription_modes WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await query('SELECT COUNT(*) FROM users');
        const recordings = await query('SELECT COUNT(*) FROM recordings WHERE date > NOW() - INTERVAL \'24 hours\'');
        res.json({ users: parseInt(users.rows[0].count), activeRecordings24h: parseInt(recordings.rows[0].count) });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.listen(Number(port), "0.0.0.0", () => {
    console.log(`Backend running on port ${port}`);
});

export default app;