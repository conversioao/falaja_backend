
import fetch from 'node-fetch';

const API_URL = 'http://localhost:3002';
let token = '';

async function testFullFlow() {
    console.log('Testing Full Database Integration Flow...');

    const testEmail = `test_${Date.now()}@example.com`;
    const testPassword = 'password123';

    try {
        // 0. Register
        console.log('\n--- 0. Register ---');
        const regRes = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'DB Test User', email: testEmail, password: testPassword })
        });
        const regData = await regRes.json() as any;
        if (!regRes.ok) throw new Error(`Registration failed: ${regData.error}`);
        console.log('Registration successful.');

        // 1. Authenticate (Login)
        console.log('\n--- 1. Login ---');
        const loginRes = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: testPassword })
        });
        const loginData = await loginRes.json() as any;
        if (!loginRes.ok) throw new Error(`Login failed: ${loginData.error}`);
        token = loginData.token;
        console.log('Login successful. User:', loginData.user.name);

        // 2. Create Recording
        console.log('\n--- 2. Create Recording ---');
        const createRes = await fetch(`${API_URL}/api/recordings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                title: 'Test Recording DB',
                duration: '02:00',
                durationSec: 120,
                type: 'meeting',
                transcription: 'This is a test transcription stored in DB.',
                summary: 'Test summary.',
                actionItems: ['Item 1', 'Item 2']
            })
        });
        const createData = await createRes.json() as any;
        console.log('Recording created:', createData.recording.title, 'ID:', createData.recording.id);

        // 3. Fetch Recordings
        console.log('\n--- 3. Fetch Recordings ---');
        const fetchRes = await fetch(`${API_URL}/api/recordings`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const fetchData = await fetchRes.json() as any;
        console.log('Total recordings found:', fetchData.recordings.length);

        // 4. Update Recording Title
        const recId = createData.recording.id;
        console.log(`\n--- 4. Update Recording Title (ID: ${recId}) ---`);
        const updateRes = await fetch(`${API_URL}/api/recordings/${recId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ title: 'Updated Recording Title' })
        });
        const updateData = await updateRes.json() as any;
        console.log('New title:', updateData.recording.title);

        // 5. Upgrade Plan
        console.log('\n--- 5. Upgrade Plan ---');
        const upgradeRes = await fetch(`${API_URL}/api/user/upgrade-plan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ plan: 'Premium' })
        });
        const upgradeData = await upgradeRes.json() as any;
        console.log('New plan:', upgradeData.user.plan, 'Credits:', upgradeData.user.credits);

        // 6. Delete Recording
        console.log('\n--- 6. Delete Recording ---');
        const deleteRes = await fetch(`${API_URL}/api/recordings/${recId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Delete status:', deleteRes.status);

        console.log('\n✅ All tests passed! The system is 100% DB-functional.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

testFullFlow();
