import express from 'express';
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
        // Check for is_read column
        const isReadCheck = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings' AND column_name = 'is_read'");
        if (isReadCheck.rows.length === 0) {
            console.log('[Migration] Adding missing column is_read to recordings table...');
            await query("ALTER TABLE recordings ADD COLUMN is_read BOOLEAN DEFAULT false");
            console.log('[Migration] Column is_read added.');
        }
        else {
            console.log('[Migration] Column is_read already exists.');
        }
        // Check for summary column
        const summaryCheck = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings' AND column_name = 'summary'");
        if (summaryCheck.rows.length === 0) {
            console.log('[Migration] Adding missing column summary to recordings table...');
            await query("ALTER TABLE recordings ADD COLUMN summary TEXT");
            console.log('[Migration] Column summary added.');
        }
        else {
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
    }
    catch (err) {
        console.error('[Migration] CRITICAL ERROR during schema verification:', err);
    }
}
// Run migration on startup
ensureSchema();
const app = express();
const port = process.env.PORT || 3003;
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
    }
    catch (err) {
        res.status(500).json({ status: 'error', database: err.message });
    }
});
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
// Routes
app.get('/', (req, res) => {
    res.send('<h1>FalaJá API</h1><p>O servidor backend está a funcionar corretamente. Por favor, aceda à aplicação através do frontend (geralmente na porta 5173 ou via npm run dev).</p>');
});
// Middleware to authenticate JWT
const authenticateToken = (req, res, next) => {
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
const requireAdmin = async (req, res, next) => {
    try {
        const result = await query('SELECT role FROM users WHERE id = $1', [req.userId]);
        const user = result.rows[0];
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    }
    catch (error) {
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
        await query('INSERT INTO users (name, whatsapp, password_hash, verification_code, is_verified, credits, used_minutes, app_mode, role, plan, email) VALUES ($1, $2, $3, $4, false, $5, 0, $6, $7, $8, $9)', [name, whatsapp, passwordHash, code, welcomeBonus, 'professional', 'user', 'Gratuito', `${whatsapp}@falaja.ao`]);
        res.status(201).json({ needsVerification: true, message: 'Código de verificação enviado' });
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});
app.post('/api/auth/resend-code', async (req, res) => {
    const { whatsapp } = req.body;
    if (!whatsapp)
        return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    try {
        const result = await query('SELECT * FROM users WHERE whatsapp = $1', [whatsapp]);
        const user = result.rows[0];
        if (!user)
            return res.status(404).json({ error: 'Usuário não encontrado' });
        if (user.is_blocked) {
            return res.status(403).json({ error: 'Conta bloqueada por excesso de tentativas.' });
        }
        if (user.verification_attempts >= 3) {
            await query('UPDATE users SET is_blocked = true WHERE id = $1', [user.id]);
            return res.status(403).json({ error: 'Limite de tentativas excedido. Conta bloqueada.' });
        }
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const settingRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'welcome_bonus' LIMIT 1");
        const welcomeBonus = parseInt(settingRes.rows[0]?.setting_value || '10');
        await query('UPDATE users SET verification_code = $1, verification_attempts = verification_attempts + 1 WHERE id = $2', [code, user.id]);
        const webhookRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'webhook_cadastro' LIMIT 1");
        const webhookUrl = webhookRes.rows[0]?.setting_value || process.env.N8N_WEBHOOK_CADASTRO;
        if (webhookUrl) {
            try {
                await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: 'user_resend_code_and_bonus',
                        user: { id: user.id, name: user.name, whatsapp: user.whatsapp, bonus_credits: welcomeBonus },
                        verification_code: code
                    })
                });
            }
            catch (err) {
                console.error('Failed to send resend-code webhook:', err);
            }
        }
        res.json({ message: 'Código reenviado e minutos adicionados' });
    }
    catch (error) {
        console.error('Resend code error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});
app.post('/api/auth/login', async (req, res) => {
    const { whatsapp, password } = req.body;
    if (!whatsapp || !password) {
        return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    }
    try {
        const result = await query('SELECT * FROM users WHERE whatsapp = $1', [whatsapp]);
        const user = result.rows[0];
        if (!user || !(await comparePassword(password, user.password_hash))) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        if (user.is_blocked) {
            return res.status(403).json({ error: 'Sua conta está bloqueada.' });
        }
        if (!user.is_verified) {
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            await query('UPDATE users SET verification_code = $1 WHERE id = $2', [code, user.id]);
            const settingRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'webhook_cadastro' LIMIT 1");
            const webhookUrl = settingRes.rows[0]?.setting_value || process.env.N8N_WEBHOOK_CADASTRO;
            if (webhookUrl) {
                try {
                    await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            event: 'user_registered',
                            user: { id: user.id, name: user.name, whatsapp: user.whatsapp },
                            verification_code: code
                        })
                    });
                }
                catch (err) {
                    console.error('Failed to send to registration webhook:', err);
                }
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
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        await query('UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1', [req.userId]);
        const result = await query('SELECT id, name, email, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", role, app_mode as "appMode" FROM users WHERE id = $1', [req.userId]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// --- RECORDINGS ROUTES ---
app.get('/api/recordings', authenticateToken, async (req, res) => {
    try {
        const result = await query('SELECT id, title, date, duration, duration_sec as "durationSec", status, type, transcription, summary, action_items as "actionItems", audio_url as "audioUrl", COALESCE(is_read, false) as "isRead" FROM recordings WHERE user_id = $1 ORDER BY date DESC', [req.userId]);
        res.json({ recordings: result.rows });
    }
    catch (error) {
        console.error('Get recordings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/recordings/:id/read', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await query('UPDATE recordings SET is_read = true WHERE id = $1 AND user_id = $2', [id, req.userId]);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/transcribe', express.raw({ type: '*/*', limit: '50mb' }), authenticateToken, async (req, res) => {
    try {
        const mode = (req.headers['x-mode'] || 'Transcrição Padrão').toString();
        const settingRes = await query("SELECT setting_key, setting_value FROM global_settings WHERE setting_key IN ('n8n_webhook_url', 'n8n_webhook_simple')");
        const settingsMap = {};
        settingRes.rows.forEach((row) => {
            settingsMap[row.setting_key] = row.setting_value;
        });
        const defaultWebhookUrl = settingsMap['n8n_webhook_url'] || process.env.N8N_TRANSCRIPTION_WEBHOOK;
        const simpleWebhookUrl = settingsMap['n8n_webhook_simple'] || defaultWebhookUrl;
        const isSimpleMode = mode.toLowerCase().includes('simples') || mode.toLowerCase().includes('padrão') || mode === 'Transcrição Padrão';
        const webhookUrl = isSimpleMode ? simpleWebhookUrl : defaultWebhookUrl;
        if (!webhookUrl) {
            return res.status(500).json({ error: 'Webhook service not configured in Admin panel' });
        }
        const modeRes = await query('SELECT multiplier FROM transcription_modes WHERE name = $1 OR name ILIKE $1', [mode]);
        const multiplier = parseFloat(modeRes.rows[0]?.multiplier || '1.0');
        const userRes = await query('SELECT name, whatsapp, plan, credits FROM users WHERE id = $1', [req.userId]);
        const user = userRes.rows[0];
        const initialDuration = (req.headers['x-duration'] || '00:00');
        const initialDurationSec = parseInt((req.headers['x-duration-sec'] || '0')) || 0;
        const initialUsedMinutesInc = Math.ceil(((initialDurationSec || 0) * multiplier) / 60);
        if (user && (user.credits || 0) < initialUsedMinutesInc) {
            return res.status(402).json({ error: `Saldo insuficiente para esta duração. Necessário: ${initialUsedMinutesInc} min, Disponível: ${user.credits || 0} min.` });
        }
        await query('BEGIN');
        if (initialUsedMinutesInc > 0) {
            await query('UPDATE users SET used_minutes = COALESCE(used_minutes, 0) + $1, credits = GREATEST(0, COALESCE(credits, 0) - $1) WHERE id = $2', [initialUsedMinutesInc, req.userId]);
        }
        const recordingResult = await query('INSERT INTO recordings (user_id, title, date, duration, duration_sec, status, type) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6) RETURNING id', [req.userId, `Gravação ${new Date().toLocaleString()}`, initialDuration, initialDurationSec, 'processing', mode]);
        const recordingId = recordingResult.rows[0].id;
        await query('COMMIT');
        const callbackUrl = `${process.env.BACKEND_URL || req.protocol + '://' + req.get('host')}/api/webhooks/transcription-complete`;
        fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': req.headers['content-type'] || 'audio/wav',
                'X-User-Id': (req.userId || '').toString(),
                'X-Mode': mode.toString(),
                'X-Recording-Id': recordingId.toString(),
                'X-Callback-Url': callbackUrl,
                'X-User-Name': user ? encodeURIComponent(user.name) : 'Unknown',
                'X-User-Whatsapp': user ? user.whatsapp : 'Unknown'
            },
            body: req.body
        }).catch(err => console.error('Background transcription trigger failed:', err));
        res.json({ success: true, message: 'Transcrição iniciada.', recordingId: recordingId });
    }
    catch (error) {
        await query('ROLLBACK');
        res.status(500).json({ error: 'Falha ao iniciar transcrição' });
    }
});
// --- WEBHOOKS ---
app.post('/api/webhooks/transcription-complete', async (req, res) => {
    const { recordingId, transcription, summary, actionItems, durationSec: initialDurationSec, userId, titulo, title: n8nTitle, duration: n8nDuration } = req.body;
    if (!recordingId)
        return res.status(400).json({ error: 'Missing recordingId' });
    try {
        const suggestedTitle = n8nTitle || titulo;
        const recData = await query('SELECT type, user_id, duration_sec FROM recordings WHERE id = $1', [recordingId]);
        if (recData.rows.length === 0)
            return res.status(404).json({ error: 'Recording not found' });
        const mode = recData.rows[0].type;
        const targetUserId = recData.rows[0].user_id;
        const prevDurationSec = recData.rows[0].duration_sec || 0;
        const finalDurationSec = n8nDuration !== undefined ? parseInt(n8nDuration) : (initialDurationSec !== undefined ? parseInt(initialDurationSec) : prevDurationSec);
        const modeRes = await query('SELECT multiplier FROM transcription_modes WHERE name = $1 OR name ILIKE $1', [mode]);
        const multiplier = parseFloat(modeRes.rows[0]?.multiplier || '1.0');
        const newUsedMinutesInc = Math.ceil(((finalDurationSec || 0) * multiplier) / 60);
        const prevUsedMinutes = Math.ceil(((prevDurationSec || 0) * multiplier) / 60);
        const creditAdjustment = newUsedMinutesInc - prevUsedMinutes;
        let finalTitle = suggestedTitle?.trim();
        if (finalTitle && finalTitle.length > 80)
            finalTitle = finalTitle.substring(0, 77) + '...';
        await query('BEGIN');
        let updateQuery = 'UPDATE recordings SET transcription = $1, summary = $2, action_items = $3, status = \'completed\', is_read = false';
        let params = [transcription, summary, actionItems];
        let paramIdx = 4;
        if (finalDurationSec !== undefined) {
            updateQuery += `, duration_sec = $${paramIdx++}`;
            params.push(finalDurationSec);
            updateQuery += `, duration = $${paramIdx++}`;
            params.push(formatDuration(finalDurationSec));
        }
        if (finalTitle) {
            updateQuery += `, title = $${paramIdx++}`;
            params.push(finalTitle);
        }
        updateQuery += ` WHERE id = $${paramIdx++}`;
        params.push(recordingId);
        await query(updateQuery, params);
        if (creditAdjustment !== 0) {
            await query('UPDATE users SET used_minutes = COALESCE(used_minutes, 0) + $1, credits = GREATEST(0, COALESCE(credits, 0) - $1) WHERE id = $2', [creditAdjustment, targetUserId]);
        }
        await query('COMMIT');
        res.json({ success: true });
    }
    catch (error) {
        await query('ROLLBACK');
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/recordings', authenticateToken, async (req, res) => {
    const { title, duration, durationSec, type, transcription, summary, actionItems } = req.body;
    try {
        const userRes = await query('SELECT credits FROM users WHERE id = $1', [req.userId]);
        const user = userRes.rows[0];
        if (user && user.credits <= 0)
            return res.status(402).json({ error: 'Saldo insuficiente.' });
        await query('BEGIN');
        const modeRes = await query('SELECT multiplier FROM transcription_modes WHERE name = $1', [type]);
        const multiplier = modeRes.rows[0]?.multiplier || 1.0;
        const recordingResult = await query('INSERT INTO recordings (user_id, title, duration, duration_sec, type, transcription, summary, action_items, is_read) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false) RETURNING id, title, date, duration, duration_sec as "durationSec", status, type, transcription, summary, action_items as "actionItems", audio_url as "audioUrl", is_read as "isRead"', [req.userId, title, duration, durationSec, type, transcription, summary, actionItems]);
        const usedMinutesInc = Math.ceil(((durationSec || 0) * multiplier) / 60);
        await query('UPDATE users SET used_minutes = COALESCE(used_minutes, 0) + $1, credits = COALESCE(credits, 0) - $1 WHERE id = $2', [usedMinutesInc, req.userId]);
        await query('COMMIT');
        res.status(201).json({ recording: recordingResult.rows[0] });
    }
    catch (error) {
        await query('ROLLBACK');
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/recordings/:id', authenticateToken, async (req, res) => {
    const { title, transcription, summary, actionItems, isRead } = req.body;
    const { id } = req.params;
    try {
        const result = await query(`UPDATE recordings 
             SET title = COALESCE($1, title),
                 transcription = COALESCE($2, transcription),
                 summary = COALESCE($3, summary),
                 action_items = COALESCE($4, action_items),
                 is_read = COALESCE($5, is_read)
             WHERE id = $6 AND user_id = $7 
             RETURNING id, title, transcription, summary, action_items as "actionItems", is_read as "isRead"`, [title, transcription, summary, actionItems, isRead, id, req.userId]);
        if (result.rows.length === 0)
            return res.status(404).json({ error: 'Recording not found' });
        res.json({ recording: result.rows[0] });
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/recordings/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query('DELETE FROM recordings WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.userId]);
        if (result.rows.length === 0)
            return res.status(404).json({ error: 'Recording not found' });
        res.json({ message: 'Recording deleted' });
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// --- ADMIN & SETTINGS ---
app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT setting_key, setting_value FROM global_settings');
        const settings = result.rows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});
        res.json({ settings });
    }
    catch (err) {
        res.status(500).json({ error: 'Erro ao carregar configurações' });
    }
});
app.put('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = req.body;
        for (const [key, value] of Object.entries(settings)) {
            await query(`INSERT INTO global_settings (setting_key, setting_value) VALUES ($1, $2)
                 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`, [key, value]);
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
});
// --- BASE ROUTES ---
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT id, name, whatsapp, plan, credits, used_minutes as "usedMinutes", role, created_at as "createdAt" FROM users ORDER BY created_at DESC');
        res.json({ users: result.rows });
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.listen(Number(port), "0.0.0.0", () => {
    console.log(`Auth API running on port ${port}`);
});
export default app;
