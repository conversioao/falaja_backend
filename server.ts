import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query } from './db.js';
import { hashPassword, comparePassword, generateToken, verifyToken } from './auth.js';
import fetch from 'node-fetch';

dotenv.config();

// Disable SSL verification for local development (needed for n8n.local with self-signed certs)
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Database Schema Migration
async function ensureSchema() {
    console.log('[Migration] Verifying database schema...');
    try {
        // Check for is_read column
        const isReadCheck = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings' AND column_name = 'is_read'");
        if (isReadCheck.rows.length === 0) {
            console.log('[Migration] Adding missing column is_read to recordings table...');
            await query("ALTER TABLE recordings ADD COLUMN is_read BOOLEAN DEFAULT false");
            console.log('[Migration] Column is_read added.');
        } else {
            console.log('[Migration] Column is_read already exists.');
        }

        // Check for summary column
        const summaryCheck = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings' AND column_name = 'summary'");
        if (summaryCheck.rows.length === 0) {
            console.log('[Migration] Adding missing column summary to recordings table...');
            await query("ALTER TABLE recordings ADD COLUMN summary TEXT");
            console.log('[Migration] Column summary added.');
        } else {
            console.log('[Migration] Column summary already exists.');
        }

        // Check for action_items column
        const actionItemsCheck = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings' AND column_name = 'action_items'");
        if (actionItemsCheck.rows.length === 0) {
            console.log('[Migration] Adding missing column action_items to recordings table...');
            await query("ALTER TABLE recordings ADD COLUMN action_items JSONB DEFAULT '[]'");
            console.log('[Migration] Column action_items added.');
        }

        // Fix NULL values for credits and used_minutes
        console.log('[Migration] Cleaning up NULL values in users table...');
        const resUsed = await query('UPDATE users SET used_minutes = 0 WHERE used_minutes IS NULL');
        const resCredits = await query('UPDATE users SET credits = 0 WHERE credits IS NULL');
        const usedCount = resUsed?.rowCount ?? 0;
        const creditsCount = resCredits?.rowCount ?? 0;
        if (usedCount > 0 || creditsCount > 0) {
            console.log(`[Migration] Cleanup complete: ${usedCount} used_minutes and ${creditsCount} credits updated.`);
        }
        console.log('[Migration] Database schema verified successfully.');
    } catch (err) {
        console.error('[Migration] CRITICAL ERROR during schema verification:', err);
    }
}

// Run migration on startup
ensureSchema();

const app = express();
const port = process.env.PORT || 3003;

interface AuthenticatedRequest extends Request {
    userId?: number;
}

// Health Check with DB Verify
app.get('/api/health', async (req, res) => {
    try {
        const dbCheck = await query('SELECT NOW()');
        const schemaCheck = await query("SELECT count(*) FROM information_schema.columns WHERE table_name = 'recordings'");
        res.json({
            status: 'ok',
            database: 'connected',
            time: dbCheck.rows[0].now,
            schema_columns: parseInt(schemaCheck.rows[0].count),
            env: process.env.NODE_ENV
        });
    } catch (err: any) {
        res.status(500).json({ status: 'error', database: err.message });
    }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Routes
app.get('/', (req, res) => {
    res.send('<h1>FalaJá API</h1><p>O servidor backend está a funcionar corretamente. Por favor, aceda à aplicação através do frontend.</p>');
});

// Middleware to authenticate JWT
const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    req.userId = decoded.id;
    next();
};

// Middleware to require admin role
const requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const result = await query('SELECT role FROM users WHERE id = $1', [req.userId]);
        const user = result.rows[0];
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

// --- AUTH ROUTES ---
const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();

app.post('/api/auth/register', async (req, res) => {
    const { name, whatsapp, password } = req.body;
    if (!name || !whatsapp || !password) {
        return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    }
    try {
        const existingUser = await query('SELECT id FROM users WHERE whatsapp = $1', [whatsapp]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Usuário já existe' });
        }
        const passwordHash = await hashPassword(password);
        const code = generateVerificationCode();
        const settingRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'welcome_bonus' LIMIT 1");
        const welcomeBonus = parseInt(settingRes.rows[0]?.setting_value || '10');
        await query('INSERT INTO users (name, whatsapp, password_hash, verification_code, is_verified, credits, used_minutes, app_mode, role, plan, email) VALUES ($1, $2, $3, $4, false, $5, 0, $6, $7, $8, $9)', 
            [name, whatsapp, passwordHash, code, welcomeBonus, 'professional', 'user', 'Gratuito', `${whatsapp}@falaja.ao`]);
        res.status(201).json({ needsVerification: true, message: 'Código de verificação enviado' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/auth/verify', async (req, res) => {
    const { whatsapp, code } = req.body;
    if (!whatsapp || !code) {
        return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    }
    try {
        const result = await query('SELECT * FROM users WHERE whatsapp = $1', [whatsapp]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        if (user.is_blocked) {
            return res.status(403).json({ error: 'Conta bloqueada por excesso de tentativas.' });
        }
        if (user.verification_code !== code) {
            return res.status(401).json({ error: 'Código inválido' });
        }
        await query('UPDATE users SET is_verified = true, verification_code = NULL WHERE id = $1', [user.id]);
        const token = generateToken({ id: user.id });
        delete user.password_hash;
        delete user.verification_code;
        user.usedMinutes = user.used_minutes || 0;
        user.avatarUrl = user.avatar_url;
        user.appMode = user.app_mode || 'professional';
        user.role = user.role || 'user';
        res.json({ user, token });
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/auth/resend-code', async (req, res) => {
    const { whatsapp } = req.body;
    if (!whatsapp) return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    try {
        const result = await query('SELECT * FROM users WHERE whatsapp = $1', [whatsapp]);
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (user.is_blocked) return res.status(403).json({ error: 'Conta bloqueada.' });
        if (user.verification_attempts >= 3) {
            await query('UPDATE users SET is_blocked = true WHERE id = $1', [user.id]);
            return res.status(403).json({ error: 'Limite de tentativas excedido.' });
        }
        const code = generateVerificationCode();
        const settingRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'welcome_bonus' LIMIT 1");
        const welcomeBonus = parseInt(settingRes.rows[0]?.setting_value || '10');
        await query('UPDATE users SET verification_code = $1, verification_attempts = verification_attempts + 1 WHERE id = $2', [code, user.id]);
        
        const webhookRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'webhook_cadastro' LIMIT 1");
        const webhookUrl = webhookRes.rows[0]?.setting_value || process.env.N8N_WEBHOOK_CADASTRO;
        if (webhookUrl) {
            fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: 'user_resend_code_and_bonus', user: { id: user.id, name: user.name, whatsapp: user.whatsapp, bonus_credits: welcomeBonus }, verification_code: code })
            }).catch(err => console.error('Failed to send resend-code webhook:', err));
        }
        res.json({ message: 'Código reenviado' });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { whatsapp, password } = req.body;
    if (!whatsapp || !password) return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    try {
        const result = await query('SELECT * FROM users WHERE whatsapp = $1', [whatsapp]);
        const user = result.rows[0];
        if (!user || !(await comparePassword(password, user.password_hash))) return res.status(401).json({ error: 'Credenciais inválidas' });
        if (user.is_blocked) return res.status(403).json({ error: 'Sua conta está bloqueada.' });
        if (!user.is_verified) {
            const code = generateVerificationCode();
            await query('UPDATE users SET verification_code = $1 WHERE id = $2', [code, user.id]);
            const settingRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'webhook_cadastro' LIMIT 1");
            const webhookUrl = settingRes.rows[0]?.setting_value || process.env.N8N_WEBHOOK_CADASTRO;
            if (webhookUrl) {
                fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ event: 'user_registered', user: { id: user.id, name: user.name, whatsapp: user.whatsapp }, verification_code: code })
                }).catch(err => console.error('Failed to send to registration webhook:', err));
            }
            return res.json({ needsVerification: true, message: 'Novo código enviado. Verifique seu WhatsApp.' });
        }
        const token = generateToken({ id: user.id });
        delete user.password_hash;
        delete user.verification_code;
        user.usedMinutes = user.used_minutes || 0;
        user.avatarUrl = user.avatar_url;
        user.appMode = user.app_mode || 'professional';
        user.role = user.role || 'user';
        res.json({ user, token });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        await query('UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1', [req.userId]);
        const result = await query('SELECT id, name, email, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", role, app_mode as "appMode" FROM users WHERE id = $1', [req.userId]);
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- RECORDINGS ROUTES ---
app.get('/api/recordings', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const result = await query('SELECT id, title, date, duration, duration_sec as "durationSec", status, type, transcription, summary, action_items as "actionItems", audio_url as "audioUrl", COALESCE(is_read, false) as "isRead" FROM recordings WHERE user_id = $1 ORDER BY date DESC', [req.userId]);
        res.json({ recordings: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.patch('/api/recordings/:id/read', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        await query('UPDATE recordings SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/transcribe', express.raw({ type: '*/*', limit: '50mb' }), authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const mode = (req.headers['x-mode'] || 'Transcrição Padrão').toString();
        const settingRes = await query("SELECT setting_key, setting_value FROM global_settings WHERE setting_key IN ('n8n_webhook_url', 'n8n_webhook_simple')");
        const settingsMap: any = {};
        settingRes.rows.forEach((row: any) => settingsMap[row.setting_key] = row.setting_value);
        const webhookUrl = (mode.toLowerCase().includes('simples') || mode.toLowerCase().includes('padrão')) ? settingsMap['n8n_webhook_simple'] : settingsMap['n8n_webhook_url'];
        if (!webhookUrl) return res.status(500).json({ error: 'Webhook service not configured' });

        const modeRes = await query('SELECT multiplier FROM transcription_modes WHERE name = $1 OR name ILIKE $1', [mode]);
        const multiplier = parseFloat(modeRes.rows[0]?.multiplier || '1.0');

        const userRes = await query('SELECT name, whatsapp, plan, credits FROM users WHERE id = $1', [req.userId]);
        const user = userRes.rows[0];
        const durationSec = parseInt(req.headers['x-duration-sec'] as string || '0');
        const creditsNeeded = Math.ceil((durationSec * multiplier) / 60);

        if (user && (user.credits || 0) < creditsNeeded) {
            return res.status(402).json({ error: `Saldo insuficiente. Necessário: ${creditsNeeded} min.` });
        }

        await query('BEGIN');
        if (creditsNeeded > 0) {
            await query('UPDATE users SET used_minutes = COALESCE(used_minutes, 0) + $1, credits = GREATEST(0, COALESCE(credits, 0) - $1) WHERE id = $2', [creditsNeeded, req.userId]);
        }
        const recordingResult = await query('INSERT INTO recordings (user_id, title, date, duration, duration_sec, status, type) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6) RETURNING id', [req.userId, `Gravação ${new Date().toLocaleString()}`, req.headers['x-duration'], durationSec, 'processing', mode]);
        const recordingId = recordingResult.rows[0].id;
        await query('COMMIT');

        const callbackUrl = `${process.env.BACKEND_URL || req.protocol + '://' + req.get('host')}/api/webhooks/transcription-complete`;
        fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': req.headers['content-type'] as string || 'audio/wav', 'X-User-Id': req.userId!.toString(), 'X-Mode': mode, 'X-Recording-Id': recordingId.toString(), 'X-Callback-Url': callbackUrl, 'X-User-Name': encodeURIComponent(user.name), 'X-User-Whatsapp': user.whatsapp },
            body: req.body
        }).catch(err => console.error('Background transcription trigger failed:', err));

        res.json({ success: true, recordingId });
    } catch (error) {
        await query('ROLLBACK');
        res.status(500).json({ error: 'Falha ao iniciar transcrição' });
    }
});

app.post('/api/webhooks/transcription-complete', async (req, res) => {
    const { recordingId, transcription, summary, actionItems, durationSec: n8nDuration, title: n8nTitle } = req.body;
    if (!recordingId) return res.status(400).json({ error: 'Missing recordingId' });
    try {
        const recData = await query('SELECT type, user_id, duration_sec FROM recordings WHERE id = $1', [recordingId]);
        if (recData.rows.length === 0) return res.status(404).json({ error: 'Recording not found' });
        
        const mode = recData.rows[0].type;
        const targetUserId = recData.rows[0].user_id;
        const prevDurationSec = recData.rows[0].duration_sec || 0;
        const finalDurationSec = n8nDuration !== undefined ? parseInt(n8nDuration) : prevDurationSec;
        
        const modeRes = await query('SELECT multiplier FROM transcription_modes WHERE name = $1 OR name ILIKE $1', [mode]);
        const multiplier = parseFloat(modeRes.rows[0]?.multiplier || '1.0');
        
        const newUsedMinutes = Math.ceil((finalDurationSec * multiplier) / 60);
        const prevUsedMinutes = Math.ceil((prevDurationSec * multiplier) / 60);
        const creditAdjustment = newUsedMinutes - prevUsedMinutes;

        await query('BEGIN');
        await query('UPDATE recordings SET transcription = $1, summary = $2, action_items = $3, status = \'completed\', duration_sec = $4, duration = $5, title = COALESCE($6, title), is_read = false WHERE id = $7', 
            [transcription, summary, actionItems, finalDurationSec, formatDuration(finalDurationSec), n8nTitle, recordingId]);
        
        if (creditAdjustment !== 0) {
            await query('UPDATE users SET used_minutes = COALESCE(used_minutes, 0) + $1, credits = GREATEST(0, COALESCE(credits, 0) - $1) WHERE id = $2', [creditAdjustment, targetUserId]);
        }
        await query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await query('ROLLBACK');
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/recordings', authenticateToken, async (req: AuthenticatedRequest, res) => {
    const { title, duration, durationSec, type, transcription, summary, actionItems } = req.body;
    try {
        await query('BEGIN');
        const modeRes = await query('SELECT multiplier FROM transcription_modes WHERE name = $1', [type]);
        const multiplier = modeRes.rows[0]?.multiplier || 1.0;
        const usedMinutes = Math.ceil((durationSec * multiplier) / 60);
        
        const updateRes = await query('UPDATE users SET used_minutes = COALESCE(used_minutes, 0) + $1, credits = COALESCE(credits, 0) - $1 WHERE id = $2 AND COALESCE(credits, 0) >= $1 RETURNING credits', [usedMinutes, req.userId]);
        if (updateRes.rows.length === 0) {
            await query('ROLLBACK');
            return res.status(402).json({ error: 'Créditos insuficientes' });
        }
        const result = await query('INSERT INTO recordings (user_id, title, duration, duration_sec, type, transcription, summary, action_items, is_read) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false) RETURNING *', 
            [req.userId, title, duration, durationSec, type, transcription, summary, actionItems]);
        await query('COMMIT');
        res.status(201).json({ recording: result.rows[0] });
    } catch (error) {
        await query('ROLLBACK');
        res.status(500).json({ error: 'Error' });
    }
});

app.patch('/api/recordings/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
    const { title, transcription, summary, actionItems, isRead } = req.body;
    try {
        const result = await query('UPDATE recordings SET title = COALESCE($1, title), transcription = COALESCE($2, transcription), summary = COALESCE($3, summary), action_items = COALESCE($4, action_items), is_read = COALESCE($5, is_read) WHERE id = $6 AND user_id = $7 RETURNING id, title, transcription, summary, action_items as "actionItems", is_read as "isRead"', 
            [title, transcription, summary, actionItems, isRead, req.params.id, req.userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ recording: result.rows[0] });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/recordings/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const result = await query('DELETE FROM recordings WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ message: 'Deleted' });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// --- USER FEATURES ---
app.post('/api/visits', async (req, res) => {
    try {
        await query("INSERT INTO site_visits (date, count) VALUES (CURRENT_DATE, 1) ON CONFLICT (date) DO UPDATE SET count = site_visits.count + 1");
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/suggestions', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        await query('INSERT INTO suggestions (user_id, message) VALUES ($1, $2)', [req.userId, req.body.message]);
        res.status(201).json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.patch('/api/user/profile', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const { name, avatarUrl } = req.body;
        const result = await query('UPDATE users SET name = COALESCE($1, name), avatar_url = COALESCE($2, avatar_url) WHERE id = $3 RETURNING id, name, email, whatsapp, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", app_mode as "appMode", role', [name, avatarUrl, req.userId]);
        res.json({ user: result.rows[0] });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/user/add-credits', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const result = await query('UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING id, credits', [req.body.amount, req.userId]);
        res.json({ user: result.rows[0] });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.patch('/api/user/mode', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const result = await query('UPDATE users SET app_mode = $1 WHERE id = $2 RETURNING id, app_mode as "appMode"', [req.body.mode, req.userId]);
        res.json({ user: result.rows[0] });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/user/upgrade-plan', authenticateToken, async (req: AuthenticatedRequest, res) => {
    const { plan } = req.body;
    let credits = plan === 'Premium' ? 300 : 1200;
    try {
        const result = await query('UPDATE users SET plan = $1, credits = credits + $2 WHERE id = $3 RETURNING id, name, email, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", app_mode as "appMode", role', [plan, credits, req.userId]);
        res.json({ user: result.rows[0] });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// --- PAYMENTS ---
app.get('/api/payments/my', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
        const result = await query('SELECT id, type, plan_name as "planName", amount_kz as "amountKz", transaction_id as "transactionId", status, created_at as "createdAt" FROM transactions WHERE user_id = $1 ORDER BY created_at DESC', [req.userId]);
        res.json({ transactions: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/payments/submit', authenticateToken, async (req: AuthenticatedRequest, res) => {
    const { type, planName, amountKz, transactionId, proofBase64 } = req.body;
    try {
        const result = await query('INSERT INTO transactions (user_id, type, plan_name, amount_kz, transaction_id, proof_url, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [req.userId, type, planName, amountKz, transactionId, proofBase64 || null, 'pending']);
        const transaction = result.rows[0];
        const settingsRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'payment_webhook_url' LIMIT 1");
        const webhookUrl = settingsRes.rows[0]?.setting_value;
        if (webhookUrl) {
            fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'payment.submitted', transaction }) }).catch(() => {});
        }
        res.status(201).json({ transaction });
    } catch (error: any) {
        if (error.code === '23505') return res.status(400).json({ error: 'ID de transação já utilizado' });
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/payments/:id/trigger-webhook', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
    try {
        const result = await query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
        const transaction = result.rows[0];
        if (!transaction) return res.status(404).json({ error: 'Not found' });
        const settingsRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'payment_webhook_url' LIMIT 1");
        const webhookUrl = settingsRes.rows[0]?.setting_value;
        if (webhookUrl) {
            await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'payment.submitted', transaction }) });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// --- ADMIN ---
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT id, name, whatsapp, plan, credits, used_minutes as "usedMinutes", role, created_at as "createdAt" FROM users ORDER BY created_at DESC');
        res.json({ users: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/payments', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT t.*, u.name as "userName", u.email as "userEmail" FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC');
        res.json({ transactions: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/admin/payments/:id/review', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await query('BEGIN');
        const transRes = await query('SELECT * FROM transactions WHERE id = $1', [id]);
        const trans = transRes.rows[0];
        if (!trans || (trans.status !== 'pending' && trans.status !== null)) {
            await query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid transaction state' });
        }
        if (status === 'approved') {
            await query('UPDATE transactions SET status = $1, proof_url = NULL WHERE id = $2', [status, id]);
            const credits = (trans.type === 'plan_upgrade' ? (trans.plan_name === 'Premium' ? 300 : 1200) : 60);
            await query('UPDATE users SET plan = COALESCE($1, plan), credits = credits + $2 WHERE id = $3', [trans.type === 'plan_upgrade' ? trans.plan_name : null, credits, trans.user_id]);
        } else {
            await query('UPDATE transactions SET status = $1 WHERE id = $2', [status, id]);
        }
        await query('COMMIT');
        res.json({ message: `Transaction ${status}` });
    } catch (error) {
        await query('ROLLBACK');
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/admin/payments/:id/notify-user', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT t.*, u.name as "userName", u.whatsapp, u.email FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.id = $1', [req.params.id]);
        const trans = result.rows[0];
        if (!trans) return res.status(404).json({ error: 'Not found' });
        const settingsRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'notify_user_webhook' LIMIT 1");
        const webhookUrl = settingsRes.rows[0]?.setting_value;
        if (webhookUrl) {
            await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'payment.approved', transaction: trans, user: { name: trans.userName, whatsapp: trans.whatsapp, email: trans.email } }) });
            res.json({ success: true });
        } else res.status(400).json({ error: 'Webhook not configured' });
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const u = await query('SELECT COUNT(*) FROM users');
        const r = await query('SELECT COUNT(*) FROM recordings WHERE created_at > NOW() - INTERVAL \'24 hours\'');
        const m = await query('SELECT SUM(used_minutes) FROM users');
        const p = await query('SELECT COUNT(*) FROM transactions WHERE status = \'pending\'');
        res.json({ users: parseInt(u.rows[0].count), activeRecordings24h: parseInt(r.rows[0].count), totalMinutesUsed: parseInt(m.rows[0].sum || '0'), pendingPayments: parseInt(p.rows[0].count) });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/online-users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT id, name, whatsapp, last_active_at FROM users WHERE last_active_at > NOW() - INTERVAL \'5 minutes\' ORDER BY last_active_at DESC');
        res.json({ onlineUsers: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/suggestions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT s.id, s.message, s.status, s.created_at, u.name as "userName", u.whatsapp FROM suggestions s JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC');
        res.json({ suggestions: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT setting_key, setting_value FROM global_settings');
        const settings = result.rows.reduce((acc: any, row: any) => { acc[row.setting_key] = row.setting_value; return acc; }, {});
        res.json({ settings });
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        for (const [key, value] of Object.entries(req.body)) {
            await query(`INSERT INTO global_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`, [key, value]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// --- MODES & PLANS ---
app.get('/api/modes', async (req, res) => {
    try {
        const result = await query('SELECT * FROM transcription_modes ORDER BY name ASC');
        res.json({ modes: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/plans', async (req, res) => {
    try {
        const result = await query('SELECT * FROM plans ORDER BY price_kz ASC');
        res.json({ plans: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/modes', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT * FROM transcription_modes ORDER BY id ASC');
        res.json({ modes: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/credit-packages', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT * FROM credit_packages ORDER BY price_kz ASC');
        res.json({ packages: result.rows });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.listen(Number(port), "0.0.0.0", () => {
    console.log(`Backend running on port ${port}`);
});

export default app;