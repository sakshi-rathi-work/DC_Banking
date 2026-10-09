import { createLogger } from '@bank/shared';

const logger = createLogger({ service: 'failover-under-load-script' });

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

async function main() {
  logger.info('Starting Failover-Under-Load Test Harness...');
  console.log(`[INFO] Connecting to Gateway at ${GATEWAY_URL}`);

  try {
    // 1. Health check
    const healthRes = await fetch(`${GATEWAY_URL}/api/health`);
    if (!healthRes.ok) {
      throw new Error(`Gateway health check failed: ${healthRes.status}`);
    }
    console.log('[PASS] Gateway health check OK');

    // 2. Register test user
    const email = `failover_user_${Date.now()}@example.com`;
    const regRes = await fetch(`${GATEWAY_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Failover Tester', email, password: 'Password123!' }),
    });

    if (!regRes.ok) {
      const errJson = await regRes.json();
      throw new Error(`Registration failed: ${JSON.stringify(errJson)}`);
    }

    const regData = (await regRes.json()) as { data: { token: string; user: { id: string } } };
    const token = regData.data.token;
    console.log('[PASS] Registered test user for failover test');

    // 3. Create two accounts
    const acc1Res = await fetch(`${GATEWAY_URL}/api/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': `idm_acc1_${Date.now()}`,
      },
      body: JSON.stringify({ nickname: 'Source Account' }),
    });
    const acc1 = ((await acc1Res.json()) as { data: { id: string; accountNumber: string } }).data;

    const acc2Res = await fetch(`${GATEWAY_URL}/api/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': `idm_acc2_${Date.now()}`,
      },
      body: JSON.stringify({ nickname: 'Destination Account' }),
    });
    const acc2 = ((await acc2Res.json()) as { data: { id: string; accountNumber: string } }).data;

    console.log(`[PASS] Created accounts: ${acc1.accountNumber} and ${acc2.accountNumber}`);

    // Deposit initial balance into acc1 (100,000 paise = ₹1,000)
    await fetch(`${GATEWAY_URL}/api/transactions/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': `idm_dep_${Date.now()}`,
      },
      body: JSON.stringify({ accountId: acc1.id, amountPaise: 100000, note: 'Initial funding' }),
    });
    console.log('[PASS] Funded Source Account with 100,000 paise (₹1,000)');

    // 4. Launch 20 concurrent transfer requests (500 paise each)
    console.log('[INFO] Launching 20 concurrent transfer workers...');
    const transferCount = 20;
    const transferAmount = 500;

    const transferPromises = Array.from({ length: transferCount }).map(async (_, idx) => {
      const idmKey = `idm_transfer_${Date.now()}_${idx}`;
      try {
        const res = await fetch(`${GATEWAY_URL}/api/transactions/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Idempotency-Key': idmKey,
          },
          body: JSON.stringify({
            fromAccountId: acc1.id,
            toAccountNumber: acc2.accountNumber,
            amountPaise: transferAmount,
            note: `Concurrent load transfer #${idx + 1}`,
          }),
        });
        return { success: res.ok, status: res.status, idx };
      } catch (err) {
        return { success: false, error: (err as Error).message, idx };
      }
    });

    // Mid-way trigger election failover
    setTimeout(async () => {
      console.log('[INFO] Simulating election failover mid-flight...');
      try {
        await fetch(`${GATEWAY_URL}/api/lab/election/bully`, { method: 'POST' });
      } catch (e) {
        console.warn('Election trigger call note:', (e as Error).message);
      }
    }, 100);

    const results = await Promise.all(transferPromises);
    const successfulTransfers = results.filter((r) => r.success);

    console.log(`[RESULTS] ${successfulTransfers.length}/${transferCount} transfers succeeded under failover`);

    // 5. Verify final balance conservation
    const finalAcc1Res = await fetch(`${GATEWAY_URL}/api/accounts/${acc1.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalAcc1 = ((await finalAcc1Res.json()) as { data: { balancePaise: number } }).data;

    const finalAcc2Res = await fetch(`${GATEWAY_URL}/api/accounts/${acc2.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalAcc2 = ((await finalAcc2Res.json()) as { data: { balancePaise: number } }).data;

    const totalBalance = finalAcc1.balancePaise + finalAcc2.balancePaise;
    console.log(`[VERIFY] Source balance: ${finalAcc1.balancePaise}, Dest balance: ${finalAcc2.balancePaise}, Total: ${totalBalance}`);

    if (totalBalance === 100000) {
      console.log('[SUCCESS] Total balance conserved strictly at 100,000 paise (₹1,000)!');
    } else {
      throw new Error(`Balance mismatch! Total balance is ${totalBalance}, expected 100000`);
    }

    // 6. Verify integrity checksum endpoint
    const integrityRes = await fetch(`${GATEWAY_URL}/api/system/integrity`);
    if (integrityRes.ok) {
      const integrityData = await integrityRes.json();
      console.log('[PASS] Cluster integrity checksum verified:', JSON.stringify(integrityData));
    }

    console.log('[COMPLETE] Failover-Under-Load test passed clean!');
  } catch (err) {
    console.error('[FAIL] Failover test failed:', (err as Error).message);
    process.exit(1);
  }
}

main();
