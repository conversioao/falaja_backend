
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query } from './db.js';
import { hashPassword, comparePassword, generateToken, verifyToken } from './auth.js';
import fetch from 'node-fetch';

dotenv.config();

// Trigger nodemon restart after .env change

// Disable SSL verification for local development (needed for n8n.local with self-signed certs)
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const app = express();
const port = process.env.PORT || 3003;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.get('/', (req, res) => {
    res.send('<h1>FalaJá API</h1><p>O servidor backend está a funcionar corretamente. Por favor, aceda à aplicação através do frontend (geralmente na porta 5173 ou via npm run dev).</p>');
});

// Middleware to authenticate JWT
const authenticateToken = (req: any, res: any, next: any) => {
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
const requireAdmin = async (req: any, res: any, next: any) => {
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

// Generate a random 6-digit code
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

        const result = await query(
            'INSERT INTO users (name, whatsapp, password_hash, verification_code, is_verified, credits, app_mode, role, plan, email) VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9) RETURNING id, name, whatsapp, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", app_mode as "appMode", role',
            [name, whatsapp, passwordHash, code, welcomeBonus, 'professional', 'user', 'Gratuito', `${whatsapp}@falaja.ao`]
        );

        const user = result.rows[0];

        // Do not send SMS code on registration yet, wait for the user to click "Send Code" or allow the client to trigger it via `resend-code`.
        // However, we saved the code in the DB.


        res.status(201).json({ needsVerification: true, message: 'Código de verificação enviado' });
    } catch (error: any) {
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

        // Update verification code and attempts (credits are awarded only once at registration)
        await query('UPDATE users SET verification_code = $1, verification_attempts = verification_attempts + 1 WHERE id = $2', [code, user.id]);

        // Send to specified webhook
        const webhookRes = await query("SELECT webhook_cadastro FROM global_settings LIMIT 1");
        const webhookUrl = webhookRes.rows[0]?.webhook_cadastro;

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
                console.log(`Resend code triggered to webhook for ${whatsapp}`);
            } catch (err) {
                console.error('Failed to send resend-code webhook:', err);
            }
        } else {
            console.log(`Resend code triggered for ${whatsapp}: ${code} (No webhook configured)`);
        }

        res.json({ message: 'Código reenviado e minutos adicionados' });
    } catch (error) {
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

            const settingRes = await query("SELECT webhook_cadastro FROM global_settings LIMIT 1");
            const webhookUrl = settingRes.rows[0]?.webhook_cadastro;

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
                    console.log(`Verification code re-sent to webhook for ${whatsapp}`);
                } catch (err) {
                    console.error('Failed to send to registration webhook:', err);
                }
            } else {
                console.log(`Verification code for ${whatsapp}: ${code} (No webhook configured)`);
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
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req: any, res) => {
    try {
        await query('UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1', [req.userId]);
        const result = await query('SELECT id, name, email, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", role, app_mode as "appMode" FROM users WHERE id = $1', [req.userId]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- RECORDINGS ROUTES ---

app.get('/api/recordings', authenticateToken, async (req: any, res) => {
    try {
        const result = await query(
            'SELECT id, title, date, duration, duration_sec as "durationSec", status, type, transcription, summary, action_items as "actionItems", audio_url as "audioUrl", is_read as "isRead" FROM recordings WHERE user_id = $1 ORDER BY date DESC',
            [req.userId]
        );
        res.json({ recordings: result.rows });
    } catch (error) {
        console.error('Get recordings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/transcribe', authenticateToken, async (req: any, res) => {
    try {
        const mode = (req.headers['x-mode'] || 'standard').toString().toLowerCase();

        // Fetch webhook URLs from global settings
        const settingRes = await query("SELECT setting_key, setting_value FROM global_settings WHERE setting_key IN ('n8n_webhook_url', 'n8n_webhook_simple')");
        const settingsMap: Record<string, string> = {};
        settingRes.rows.forEach((row: any) => {
            settingsMap[row.setting_key] = row.setting_value;
        });

        const defaultWebhookUrl = settingsMap['n8n_webhook_url'] || process.env.N8N_TRANSCRIPTION_WEBHOOK;
        const simpleWebhookUrl = settingsMap['n8n_webhook_simple'] || defaultWebhookUrl;

        const isSimpleMode = mode === 'simple' || mode === 'transcrição padrão' || mode.includes('padrão');
        const webhookUrl = isSimpleMode ? simpleWebhookUrl : defaultWebhookUrl;

        if (!webhookUrl) {
            console.error('Transcription error: Webhook URLs not configured');
            return res.status(500).json({ error: 'Webhook service not configured in Admin panel' });
        }

        console.log(`Forwarding transcription request to: ${webhookUrl}`);

        // Obter mais informaçoes do usuario para enviar no webhook
        const userRes = await query('SELECT name, whatsapp, plan, credits FROM users WHERE id = $1', [req.userId]);
        const user = userRes.rows[0];

        if (user && user.credits <= 2) {
            return res.status(402).json({ error: 'Saldo insuficiente. Você tem 2 minutos ou menos. Recarregue para continuar gravando.' });
        }

        // Forward binary data to n8n with extra user headers
        // We trigger the fetch but we also need to pass the recording ID for the callback
        // First, create a placeholder recording
        const recordingResult = await query(
            'INSERT INTO recordings (user_id, title, date, duration, duration_sec, status, type) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6) RETURNING id',
            [req.userId, `Gravação ${new Date().toLocaleString()}`, '00:00', 0, 'processing', mode]
        );
        const recordingId = recordingResult.rows[0].id;

        const callbackUrl = `${process.env.BACKEND_URL || req.protocol + '://' + req.get('host')}/api/webhooks/transcription-complete`;

        // Trigger n8n asynchronously
        fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': req.headers['content-type'] || 'audio/wav',
                'X-User-Id': req.userId.toString(),
                'X-Mode': mode.toString(),
                'X-Recording-Id': recordingId.toString(),
                'X-Callback-Url': callbackUrl,
                'X-User-Name': user ? encodeURIComponent(user.name) : 'Unknown',
                'X-User-Whatsapp': user ? user.whatsapp : 'Unknown'
            },
            body: req
        }).catch(err => console.error('Background transcription trigger failed:', err));

        // Return immediately to the user
        res.json({
            success: true,
            message: 'Transcrição iniciada. Você será notificado no WhatsApp quando terminar.',
            recordingId: recordingId
        });

    } catch (error: any) {
        console.error('Transcription initiation error:', error);
        res.status(500).json({ error: 'Falha ao iniciar transcrição' });
    }
});

// --- WEBHOOKS ---

app.post('/api/webhooks/transcription-complete', async (req, res) => {
    const { recordingId, transcription, summary, actionItems, durationSec, userId } = req.body;

    if (!recordingId) return res.status(400).json({ error: 'Missing recordingId' });

    try {
        console.log(`Recebido callback de transcrição para gravação ${recordingId}`);

        // Get multiplier for the mode/type
        const recData = await query('SELECT type, user_id FROM recordings WHERE id = $1', [recordingId]);
        if (recData.rows.length === 0) return res.status(404).json({ error: 'Recording not found' });

        const mode = recData.rows[0].type;
        const targetUserId = recData.rows[0].user_id;

        const modeRes = await query('SELECT multiplier FROM transcription_modes WHERE name = $1', [mode]);
        const multiplier = modeRes.rows[0]?.multiplier || 1.0;

        const baseMinutes = Math.ceil((durationSec || 0) / 60);
        const usedMinutesInc = Math.ceil(baseMinutes * multiplier);

        await query('BEGIN');

        // Update recording
        await query(
            `UPDATE recordings 
             SET transcription = $1, summary = $2, action_items = $3, duration_sec = $4, status = 'completed', is_read = false
             WHERE id = $5`,
            [transcription, summary, actionItems, durationSec, recordingId]
        );

        // Deduct credits
        const updateRes = await query(
            'UPDATE users SET used_minutes = used_minutes + $1, credits = credits - $1 WHERE id = $2 AND credits >= $1 RETURNING credits, whatsapp, name',
            [usedMinutesInc, targetUserId]
        );

        await query('COMMIT');

        // Notify user via WhatsApp if possible
        if (updateRes.rows.length > 0) {
            const user = updateRes.rows[0];
            const notifyWebhook = process.env.NOTIFY_USER_WEBHOOK || 'https://falajaao-n8n-falaja.11ynya.easypanel.host/webhook-test/notificar_user';

            fetch(notifyWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    whatsapp: user.whatsapp,
                    message: `Olá ${user.name}! Sua transcrição do FalaJá está pronta. 🎉\n\nResumo: ${summary ? summary.substring(0, 100) + '...' : 'Veja os detalhes no app.'}`
                })
            }).catch(err => console.error('Failed to send WhatsApp notification:', err));
        }

        res.json({ success: true });
    } catch (error) {
        await query('ROLLBACK');
        console.error('Webhook transcription-complete error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/recordings', authenticateToken, async (req: any, res) => {
    const { title, duration, durationSec, type, transcription, summary, actionItems } = req.body;

    try {
        const userRes = await query('SELECT credits FROM users WHERE id = $1', [req.userId]);
        const user = userRes.rows[0];

        if (user && user.credits <= 2) {
            return res.status(402).json({ error: 'Saldo insuficiente. Você tem 2 minutos ou menos. Recarregue para continuar.' });
        }

        // Start transaction
        await query('BEGIN');

        // Fetch multiplier for the mode
        const modeRes = await query('SELECT multiplier FROM transcription_modes WHERE name = $1', [type]);
        const multiplier = modeRes.rows[0]?.multiplier || 1.0;

        const recordingResult = await query(
            'INSERT INTO recordings (user_id, title, duration, duration_sec, type, transcription, summary, action_items) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, title, date, duration, duration_sec as "durationSec", status, type, transcription, summary, action_items as "actionItems", audio_url as "audioUrl"',
            [req.userId, title, duration, durationSec, type, transcription, summary, actionItems]
        );

        const baseMinutes = Math.ceil(durationSec / 60);
        const usedMinutesInc = Math.ceil(baseMinutes * multiplier);

        const updateRes = await query(
            'UPDATE users SET used_minutes = used_minutes + $1, credits = credits - $1 WHERE id = $2 AND credits >= $1 RETURNING credits',
            [usedMinutesInc, req.userId]
        );

        if (updateRes.rows.length === 0) {
            await query('ROLLBACK');
            return res.status(402).json({ error: 'Créditos insuficientes para guardar esta gravação.' });
        }

        await query('COMMIT');

        res.status(201).json({ recording: recordingResult.rows[0] });
    } catch (error) {
        await query('ROLLBACK');
        console.error('Create recording error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.patch('/api/recordings/:id', authenticateToken, async (req: any, res) => {
    const { title, transcription, summary, actionItems, isRead } = req.body;
    const { id } = req.params;

    try {
        const result = await query(
            `UPDATE recordings 
             SET title = COALESCE($1, title),
                 transcription = COALESCE($2, transcription),
                 summary = COALESCE($3, summary),
                 action_items = COALESCE($4, action_items),
                 is_read = COALESCE($5, is_read)
             WHERE id = $6 AND user_id = $7 
             RETURNING id, title, transcription, summary, action_items as "actionItems", is_read as "isRead"`,
            [title, transcription, summary, actionItems, isRead, id, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        res.json({ recording: result.rows[0] });
    } catch (error) {
        console.error('Update recording error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.patch('/api/recordings/:id/read', authenticateToken, async (req: any, res) => {
    const { id } = req.params;

    try {
        const result = await query(
            'UPDATE recordings SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id, is_read as "isRead"',
            [id, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        res.json({ recording: result.rows[0] });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/recordings/:id', authenticateToken, async (req: any, res) => {
    const { id } = req.params;

    try {
        const result = await query('DELETE FROM recordings WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        res.json({ message: 'Recording deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- USER FEATURES (ANALYTICS & SUGGESTIONS) ---

app.post('/api/visits', async (req, res) => {
    try {
        await query(`
            INSERT INTO site_visits (date, count) 
            VALUES (CURRENT_DATE, 1) 
            ON CONFLICT (date) DO UPDATE SET count = site_visits.count + 1
        `);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/suggestions', authenticateToken, async (req: any, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensagem obrigatória' });
    try {
        await query('INSERT INTO suggestions (user_id, message) VALUES ($1, $2)', [req.userId, message]);
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- USER MANAGEMENT ROUTES ---

app.patch('/api/user/profile', authenticateToken, async (req: any, res) => {
    const { name, avatarUrl } = req.body;

    try {
        const result = await query(
            'UPDATE users SET name = COALESCE($1, name), avatar_url = COALESCE($2, avatar_url) WHERE id = $3 RETURNING id, name, email, whatsapp, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", app_mode as "appMode", role',
            [name, avatarUrl, req.userId]
        );

        res.json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/user/add-credits', authenticateToken, async (req: any, res) => {
    const { amount } = req.body;

    try {
        const result = await query(
            'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING id, credits',
            [amount, req.userId]
        );

        res.json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.patch('/api/user/mode', authenticateToken, async (req: any, res) => {
    const { mode } = req.body;

    if (!mode || !['simple', 'professional'].includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode' });
    }

    try {
        const result = await query(
            'UPDATE users SET app_mode = $1 WHERE id = $2 RETURNING id, app_mode as "appMode"',
            [mode, req.userId]
        );

        res.json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/user/upgrade-plan', authenticateToken, async (req: any, res) => {
    const { plan } = req.body; // 'Premium' | 'Business'
    let additionalCredits = plan === 'Premium' ? 300 : 1200;

    try {
        const result = await query(
            'UPDATE users SET plan = $1, credits = credits + $2 WHERE id = $3 RETURNING id, name, email, plan, credits, used_minutes as "usedMinutes", avatar_url as "avatarUrl", app_mode as "appMode", role',
            [plan, additionalCredits, req.userId]
        );

        res.json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- PAYMENTS ROUTES ---

app.post('/api/payments/submit', authenticateToken, async (req: any, res) => {
    const { type, planName, amountKz, transactionId, proofBase64 } = req.body;

    if (!type || !amountKz || !transactionId) {
        return res.status(400).json({ error: 'Missing payment details' });
    }

    try {
        const result = await query(
            'INSERT INTO transactions (user_id, type, plan_name, amount_kz, transaction_id, proof_url, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [req.userId, type, planName, amountKz, transactionId, proofBase64 || null, 'pending']
        );
        const transaction = result.rows[0];

        res.status(201).json({ transaction });
    } catch (error: any) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'ID de transação já utilizado' });
        }
        console.error('Payment submit error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/payments/:id/trigger-webhook', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const result = await query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, req.userId]);
        const transaction = result.rows[0];

        if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

        const settingsRes = await query('SELECT payment_webhook_url FROM global_settings LIMIT 1');
        const webhookUrl = settingsRes.rows[0]?.payment_webhook_url || 'https://falajaao-n8n-falaja.11ynya.easypanel.host/webhook-test/pagamento';

        console.log(`Disparando webhook de pagamento para transação ${id}. URL: ${webhookUrl}`);

        if (webhookUrl && webhookUrl.trim() !== '') {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: 'payment.submitted',
                    transaction: transaction,
                })
            }).then(() => console.log('Webhook disparado com sucesso!'))
                .catch(err => console.error('Failed to trigger payment webhook:', err));
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Webhook trigger error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/payments/my', authenticateToken, async (req: any, res) => {
    try {
        const result = await query(
            'SELECT id, type, plan_name as "planName", amount_kz as "amountKz", transaction_id as "transactionId", status, created_at as "createdAt" FROM transactions WHERE user_id = $1 ORDER BY created_at DESC',
            [req.userId]
        );
        res.json({ transactions: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- PLANS ROUTES ---

app.get('/api/plans', async (req, res) => {
    try {
        const result = await query('SELECT * FROM plans ORDER BY price_kz ASC');
        res.json({ plans: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- MODES ROUTES ---

app.get('/api/modes', async (req, res) => {
    try {
        const result = await query('SELECT * FROM transcription_modes ORDER BY name ASC');
        res.json({ modes: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/modes', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT * FROM transcription_modes ORDER BY id ASC');
        res.json({ modes: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/modes', authenticateToken, requireAdmin, async (req, res) => {
    const { name, multiplier, description } = req.body;
    try {
        const result = await query(
            'INSERT INTO transcription_modes (name, multiplier, description) VALUES ($1, $2, $3) RETURNING *',
            [name, multiplier, description]
        );
        res.status(201).json({ mode: result.rows[0] });
    } catch (error: any) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Modo com este nome já existe' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.patch('/api/admin/modes/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, multiplier, description } = req.body;
    try {
        const result = await query(
            'UPDATE transcription_modes SET name = COALESCE($1, name), multiplier = COALESCE($2, multiplier), description = COALESCE($3, description) WHERE id = $4 RETURNING *',
            [name, multiplier, description, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Mode not found' });
        res.json({ mode: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/modes/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query('DELETE FROM transcription_modes WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Mode not found' });
        res.json({ message: 'Mode deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/plans', authenticateToken, requireAdmin, async (req, res) => {
    const { name, price_kz, minutes, features, is_popular } = req.body;
    try {
        const result = await query(
            'INSERT INTO plans (name, price_kz, minutes, features, is_popular) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [name, price_kz, minutes, features || [], is_popular || false]
        );
        res.status(201).json({ plan: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.patch('/api/admin/plans/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, price_kz, minutes, features, is_popular } = req.body;
    try {
        const result = await query(
            'UPDATE plans SET name = COALESCE($1, name), price_kz = COALESCE($2, price_kz), minutes = COALESCE($3, minutes), features = COALESCE($4, features), is_popular = COALESCE($5, is_popular) WHERE id = $6 RETURNING *',
            [name, price_kz, minutes, features, is_popular, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
        res.json({ plan: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/plans/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query('DELETE FROM plans WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
        res.json({ message: 'Plan deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- CREDIT PACKAGES ROUTES ---

app.get('/api/credit-packages', async (req, res) => {
    try {
        const result = await query('SELECT * FROM credit_packages WHERE is_active = true ORDER BY price_kz ASC');
        res.json({ packages: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/credit-packages', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT * FROM credit_packages ORDER BY price_kz ASC');
        res.json({ packages: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/credit-packages', authenticateToken, requireAdmin, async (req, res) => {
    const { name, price_kz, minutes, is_active } = req.body;
    try {
        const result = await query(
            'INSERT INTO credit_packages (name, price_kz, minutes, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, price_kz, minutes, is_active !== undefined ? is_active : true]
        );
        res.status(201).json({ package: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.patch('/api/admin/credit-packages/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, price_kz, minutes, is_active } = req.body;
    try {
        const result = await query(
            'UPDATE credit_packages SET name = COALESCE($1, name), price_kz = COALESCE($2, price_kz), minutes = COALESCE($3, minutes), is_active = COALESCE($4, is_active) WHERE id = $5 RETURNING *',
            [name, price_kz, minutes, is_active, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Package not found' });
        res.json({ package: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/credit-packages/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query('DELETE FROM credit_packages WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Package not found' });
        res.json({ message: 'Package deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- ADMIN ROUTES ---

app.get('/api/admin/payments', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT t.*, u.name as "userName", u.email as "userEmail" 
             FROM transactions t 
             JOIN users u ON t.user_id = u.id 
             ORDER BY t.created_at DESC`
        );
        res.json({ transactions: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/payments/:id/review', authenticateToken, requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        await query('BEGIN');

        const transRes = await query('SELECT * FROM transactions WHERE id = $1', [id]);
        const trans = transRes.rows[0];

        if (!trans) {
            await query('ROLLBACK');
            return res.status(404).json({ error: 'Transaction not found' });
        }

        if (trans.status !== 'pending' && trans.status !== null) {
            await query('ROLLBACK');
            return res.status(400).json({ error: 'Transaction already reviewed' });
        }

        if (status === 'approved') {
            await query(
                'UPDATE transactions SET status = $1, proof_url = NULL WHERE id = $2',
                [status, id]
            );

            if (trans.type === 'plan_upgrade') {
                // Fetch credits from plans table
                const planResult = await query('SELECT minutes FROM plans WHERE name = $1', [trans.plan_name]);
                const credits = planResult.rows[0]?.minutes || (trans.plan_name === 'Premium' ? 300 : 1200);
                await query('UPDATE users SET plan = $1, credits = credits + $2 WHERE id = $3', [trans.plan_name, credits, trans.user_id]);
            } else if (trans.type === 'credits') {
                const packageResult = await query('SELECT minutes FROM credit_packages WHERE name = $1', [trans.plan_name]);
                const credits = packageResult.rows[0]?.minutes || 60;
                await query('UPDATE users SET credits = credits + $1 WHERE id = $2', [credits, trans.user_id]);
            }
        } else {
            await query(
                'UPDATE transactions SET status = $1 WHERE id = $2',
                [status, id]
            );
        }

        await query('COMMIT');
        res.json({ message: `Transaction ${status}` });
    } catch (error) {
        await query('ROLLBACK');
        console.error('Review error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete payment
app.delete('/api/admin/payments/:id', authenticateToken, requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    try {
        const result = await query('DELETE FROM transactions WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
        res.json({ message: 'Transaction deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/payments/:id/notify-user', authenticateToken, requireAdmin, async (req: any, res) => {
    try {
        const { id } = req.params;
        const transRes = await query(`
            SELECT t.*, u.name as "userName", u.whatsapp, u.email 
            FROM transactions t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.id = $1
        `, [id]);
        const trans = transRes.rows[0];

        if (!trans) return res.status(404).json({ error: 'Transaction not found' });

        const settingsRes = await query("SELECT setting_value FROM global_settings WHERE setting_key = 'notify_user_webhook' LIMIT 1");
        const webhookUrl = settingsRes.rows[0]?.setting_value || 'https://falajaao-n8n-falaja.11ynya.easypanel.host/webhook-test/notificar_user';

        if (webhookUrl && webhookUrl.trim() !== '') {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: 'payment.approved',
                    transaction: trans,
                    user: { name: trans.userName, whatsapp: trans.whatsapp, email: trans.email }
                })
            });
            res.json({ success: true, message: 'Usuário notificado com sucesso!' });
        } else {
            res.status(400).json({ error: 'Webhook não configurado' });
        }
    } catch (err) {
        console.error('Notify user webhook trigger error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- GLOBAL SETTINGS ---
app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT setting_key, setting_value FROM global_settings');
        const settings = result.rows.reduce((acc: any, row: any) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});
        res.json({ settings });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar configurações' });
    }
});

app.put('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = req.body;
        for (const [key, value] of Object.entries(settings)) {
            await query(
                `INSERT INTO global_settings (setting_key, setting_value) VALUES ($1, $2)
                 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
                [key, value]
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
});

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const totalUsers = await query('SELECT COUNT(*) FROM users');
        const activeRecordings = await query('SELECT COUNT(*) FROM recordings WHERE created_at > NOW() - INTERVAL \'24 hours\'');
        const totalMinutes = await query('SELECT SUM(used_minutes) FROM users');
        const pendingPayments = await query('SELECT COUNT(*) FROM transactions WHERE status = \'pending\'');

        res.json({
            users: parseInt(totalUsers.rows[0].count),
            activeRecordings24h: parseInt(activeRecordings.rows[0].count),
            totalMinutesUsed: parseInt(totalMinutes.rows[0].sum || '0'),
            pendingPayments: parseInt(pendingPayments.rows[0].count)
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/analytics', authenticateToken, requireAdmin, async (req: any, res) => {
    const { period } = req.query; // 'weekly', 'monthly', 'semiannual', 'annual'
    try {
        let dateFilter = 'NOW() - INTERVAL \'1 week\'';
        if (period === 'monthly') dateFilter = 'NOW() - INTERVAL \'1 month\'';
        if (period === 'semiannual') dateFilter = 'NOW() - INTERVAL \'6 months\'';
        if (period === 'annual') dateFilter = 'NOW() - INTERVAL \'1 year\'';

        const result = await query(`
            SELECT date, count FROM site_visits 
            WHERE date >= ${dateFilter} 
            ORDER BY date ASC
        `);
        res.json({ visits: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/online-users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // defined as active in the last 5 minutes
        const result = await query(`
            SELECT id, name, whatsapp, last_active_at 
            FROM users 
            WHERE last_active_at > NOW() - INTERVAL \'5 minutes\' 
            ORDER BY last_active_at DESC
        `);
        res.json({ onlineUsers: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/suggestions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query(`
            SELECT s.id, s.message, s.status, s.created_at, u.name as "userName", u.whatsapp 
            FROM suggestions s 
            JOIN users u ON s.user_id = u.id 
            ORDER BY s.created_at DESC
        `);
        res.json({ suggestions: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT id, name, whatsapp, plan, credits, used_minutes as "usedMinutes", role, created_at as "createdAt" FROM users ORDER BY created_at DESC');
        res.json({ users: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- SETTINGS ROUTES ---

app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await query('SELECT * FROM global_settings WHERE id = 1');
        const r = result.rows[0] || {};
        res.json({
            settings: {
                n8nApiUrl: r.n8n_api_url || '',
                n8nId: r.n8n_workflow_id || '',
                n8nWebhookUrl: r.n8n_webhook_url || '',
                storageBucket: r.storage_path || '',
                paymentWebhookUrl: r.payment_webhook_url || '',
                webhookCadastro: r.webhook_cadastro || ''
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    const { n8nApiUrl, n8nId, n8nWebhookUrl, storageBucket, paymentWebhookUrl, webhookCadastro } = req.body;
    try {
        const result = await query(
            `UPDATE global_settings 
             SET n8n_api_url = COALESCE($1, n8n_api_url),
                 n8n_workflow_id = COALESCE($2, n8n_workflow_id),
                 n8n_webhook_url = COALESCE($3, n8n_webhook_url),
                 storage_path = COALESCE($4, storage_path),
                 payment_webhook_url = COALESCE($5, payment_webhook_url),
                 webhook_cadastro = COALESCE($6, webhook_cadastro),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = 1 RETURNING *`,
            [n8nApiUrl, n8nId, n8nWebhookUrl, storageBucket, paymentWebhookUrl, webhookCadastro]
        );
        res.json({ success: true, settings: result.rows[0] });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});



app.listen(Number(port), "0.0.0.0", () => {
    console.log(`Auth API running on port ${port}`);
});

export default app;
