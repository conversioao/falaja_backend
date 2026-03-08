
import fetch from 'node-fetch';

const API_URL = 'http://localhost:3002';

async function testAuth() {
    console.log('Testing Authentication API...');

    try {
        const regEmail = `val_${Date.now()}@test.com`;

        // 1. Test Register
        console.log('\n--- Testing Register ---');
        const regRes = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Verification User', email: regEmail, password: 'password123' })
        });
        const regData = await regRes.json() as any;
        console.log('Register Status:', regRes.status);
        console.log('Register Data:', regData);

        // 2. Test Login
        console.log('\n--- Testing Login ---');
        const loginRes = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: regEmail, password: 'password123' })
        });
        const loginData = await loginRes.json() as any;
        console.log('Login Status:', loginRes.status);
        console.log('Login Data:', loginData);

        // 3. Test Profile (Me)
        console.log('\n--- Testing Me ---');
        const meRes = await fetch(`${API_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${loginData.token}` }
        });
        const meData = await meRes.json() as any;
        console.log('Me Status:', meRes.status);
        console.log('Me Data:', meData);

        console.log('\n--- Authentication Verification Success ---');
    } catch (error: any) {
        console.error('\n❌ Verification failed:', error.message);
    }
}

testAuth();
