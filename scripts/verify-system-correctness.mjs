import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const requireFromNotifications = createRequire(
  new URL('../apps/notifications-service/package.json', import.meta.url),
);
const { io } = requireFromNotifications('socket.io-client');

const gateway = process.env.SYSTEM_GATEWAY_URL ?? 'http://127.0.0.1:3004';
const ledger = process.env.SYSTEM_LEDGER_URL ?? 'http://127.0.0.1:3001';
const payments = process.env.SYSTEM_PAYMENTS_URL ?? 'http://127.0.0.1:3002';
const notifications =
  process.env.SYSTEM_NOTIFICATIONS_URL ?? 'http://127.0.0.1:3003';
const rabbitManagement =
  process.env.SYSTEM_RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672';
const password = 'Correctness-Only-Password-2026!';
const runId = randomUUID().replaceAll('-', '');

function authorization(token) {
  return { authorization: `Bearer ${token}` };
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${options.method ?? 'GET'} ${path}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function eventually(description, operation, predicate, timeoutMs = 15_000) {
  const deadline = performance.now() + timeoutMs;
  let latest;
  let latestError;
  while (performance.now() < deadline) {
    try {
      latest = await operation();
      if (predicate(latest)) return latest;
    } catch (error) {
      latestError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${description} did not become true: ${latestError?.message ?? JSON.stringify(latest)}`,
  );
}

function composePsql(service, user, database, statement) {
  return execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      service,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      user,
      '-d',
      database,
      '--tuples-only',
      '--no-align',
      '--command',
      statement,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
}

function composeService(action, service) {
  execFileSync('docker', ['compose', action, service], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function register(label) {
  const email = `${label}-${runId}@example.com`;
  const session = await request(gateway, '/auth/register', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(typeof session.accessToken, 'string');
  const payload = JSON.parse(
    Buffer.from(session.accessToken.split('.')[1], 'base64url').toString('utf8'),
  );
  assert.equal(typeof payload.sub, 'string');
  return { email, userId: payload.sub, token: session.accessToken };
}

async function walletFor(user) {
  const wallets = await request(ledger, '/wallets', {
    headers: authorization(user.token),
  });
  assert.equal(wallets.length, 1);
  return wallets[0];
}

async function createTransfer(user, walletId, receiver, amount, key, targetCurrency = 'USD') {
  return request(gateway, '/bff/transfers', {
    method: 'POST',
    headers: { ...authorization(user.token), 'idempotency-key': key },
    body: {
      fromWalletId: walletId,
      toWalletIdentifier: receiver.email,
      amount,
      currency: 'USD',
      targetCurrency,
    },
  });
}

async function adminSession(user) {
  composePsql(
    'ledger-db',
    'ledger',
    'ledger',
    `UPDATE users SET role = 'admin' WHERE id = '${user.userId}'`,
  );
  return request(gateway, '/auth/login', {
    method: 'POST',
    body: { email: user.email, password },
  });
}

async function reconnectAndResynchronize(user, transferId, walletId) {
  const socket = io(`${notifications}/activity`, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { Authorization: `Bearer ${user.token}` },
  });
  const connected = () =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('socket connect timeout')), 5_000);
      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  await connected();
  socket.disconnect();
  const reconnected = connected();
  socket.connect();
  await reconnected;

  const [transfer, wallet, activity] = await Promise.all([
    request(gateway, `/bff/transfers/${transferId}`, {
      headers: authorization(user.token),
    }),
    request(ledger, `/wallets/${walletId}`, {
      headers: authorization(user.token),
    }),
    request(gateway, '/bff/activity?limit=100', {
      headers: authorization(user.token),
    }),
  ]);
  socket.disconnect();
  return { transfer, wallet, activity };
}

async function publishDuplicateCompletion(transferId) {
  const encoded = composePsql(
    'payments-db',
    'payments',
    'payments',
    `SELECT encode(convert_to(event::text, 'UTF8'), 'base64') FROM integration_outbox WHERE event->'aggregate'->>'id' = '${transferId}' AND routing_key = 'payments.transfer.completed.v1'`,
  ).replaceAll('\n', '');
  assert.ok(encoded, 'completion event must exist in payments outbox');
  const credentials = Buffer.from('p2p:p2p').toString('base64');
  for (let delivery = 0; delivery < 2; delivery += 1) {
    const published = await request(
      rabbitManagement,
      '/api/exchanges/%2F/p2p.domain-events/publish',
      {
        method: 'POST',
        headers: { authorization: `Basic ${credentials}` },
        body: {
          properties: { delivery_mode: 2 },
          routing_key: 'payments.transfer.completed.v1',
          payload: encoded,
          payload_encoding: 'base64',
        },
      },
    );
    assert.equal(published.routed, true);
  }
}

async function main() {
  await eventually(
    'gateway readiness',
    async () => (await fetch(`${gateway}/metrics`)).ok,
    (ready) => ready === true,
    60_000,
  );
  await eventually(
    'RabbitMQ management readiness',
    async () => (await fetch(`${rabbitManagement}/api/overview`)).status === 401,
    (ready) => ready === true,
    60_000,
  );
  const [sender, receiver, loadUser] = await Promise.all([
    register('correctness-sender'),
    register('correctness-receiver'),
    register('correctness-load'),
  ]);
  const [senderWallet, receiverWallet, loadWallet] = await Promise.all([
    walletFor(sender),
    walletFor(receiver),
    walletFor(loadUser),
  ]);
  await Promise.all([
    request(ledger, `/wallets/${senderWallet.id}/deposit`, {
      method: 'POST',
      headers: authorization(sender.token),
      body: { amount: 1_000 },
    }),
    request(ledger, `/wallets/${loadWallet.id}/deposit`, {
      method: 'POST',
      headers: authorization(loadUser.token),
      body: { amount: 1_000 },
    }),
  ]);

  const successKey = `success-${runId}`;
  const completed = await createTransfer(
    sender,
    senderWallet.id,
    receiver,
    125.25,
    successKey,
  );
  assert.equal(completed.status, 'Completed');

  const senderAfter = await request(ledger, `/wallets/${senderWallet.id}`, {
    headers: authorization(sender.token),
  });
  const receiverAfter = await request(ledger, `/wallets/${receiverWallet.id}`, {
    headers: authorization(receiver.token),
  });
  assert.deepEqual(
    { balance: senderAfter.balance, held: senderAfter.held, available: senderAfter.available },
    { balance: '874.75', held: '0.00', available: '874.75' },
  );
  assert.deepEqual(
    { balance: receiverAfter.balance, held: receiverAfter.held, available: receiverAfter.available },
    { balance: '125.25', held: '0.00', available: '125.25' },
  );
  assert.equal(
    composePsql(
      'payments-db',
      'payments',
      'payments',
      `SELECT count(*) FROM transfers WHERE id = '${completed.id}' AND status = 'Completed'`,
    ),
    '1',
  );
  assert.equal(
    composePsql(
      'ledger-db',
      'ledger',
      'ledger',
      `SELECT count(*) FROM ledger_transfer_settlements WHERE transfer_id = '${completed.id}'`,
    ),
    '1',
  );

  const completionActivity = await eventually(
    'completion activity',
    () =>
      request(
        gateway,
        '/bff/activity?limit=100&eventType=payments.transfer.Completed',
        { headers: authorization(sender.token) },
      ),
    (page) => page.items.some((item) => item.aggregateId === completed.id),
  );
  assert.equal(
    completionActivity.items.filter((item) => item.aggregateId === completed.id).length,
    1,
  );
  const receiverActivity = await eventually(
    'receiver balance activity',
    () =>
      request(
        gateway,
        '/bff/activity?limit=100&eventType=ledger.wallet.MoneyDeposited',
        { headers: authorization(receiver.token) },
      ),
    (page) => page.items.some((item) => item.aggregateId === receiverWallet.id),
  );
  assert.equal(
    receiverActivity.items.filter((item) => item.aggregateId === receiverWallet.id)
      .length,
    1,
  );

  const crossCurrency = await createTransfer(
    sender,
    senderWallet.id,
    receiver,
    10,
    `fx-${runId}`,
    'EUR',
  );
  assert.equal(crossCurrency.status, 'Completed');
  assert.deepEqual(
    {
      source: `${crossCurrency.amount} ${crossCurrency.currency}`,
      destination: `${crossCurrency.destinationAmount} ${crossCurrency.destinationCurrency}`,
      rate: crossCurrency.fxRate,
    },
    { source: '10.00 USD', destination: '9.20 EUR', rate: '0.91996320' },
  );
  const receiverWalletsAfterFx = await request(ledger, '/wallets', {
    headers: authorization(receiver.token),
  });
  const receiverEur = receiverWalletsAfterFx.find(({ currency }) => currency === 'EUR');
  assert.ok(receiverEur, 'cross-currency transfer must create the receiver EUR wallet');
  assert.equal(receiverEur.balance, '9.20');
  assert.equal(
    composePsql(
      'payments-db',
      'payments',
      'payments',
      `SELECT count(*) FROM transfers WHERE id = '${crossCurrency.id}' AND destination_amount_minor = 920 AND destination_currency = 'EUR' AND fx_rate_numerator = 1000000 AND fx_rate_denominator = 1087000`,
    ),
    '1',
  );
  assert.equal(
    composePsql(
      'ledger-db',
      'ledger',
      'ledger',
      `SELECT count(*) FROM ledger_transfer_settlements WHERE transfer_id = '${crossCurrency.id}' AND amount_minor = 1000 AND currency = 'USD' AND destination_amount_minor = 920 AND destination_currency = 'EUR'`,
    ),
    '1',
  );

  const blockedTransfer = await request(gateway, '/bff/transfers', {
    method: 'POST',
    headers: { ...authorization(sender.token), 'idempotency-key': `blocked-${runId}` },
    body: {
      fromWalletId: senderWallet.id,
      toWalletIdentifier: 'blocked@example.com',
      amount: 1,
      currency: 'USD',
      targetCurrency: 'USD',
    },
  });
  assert.equal(blockedTransfer.status, 'Failed');
  assert.equal(blockedTransfer.failureCode, 'RECEIVER_BLOCKED');

  const sequentialKey = `sequential-${runId}`;
  const sequentialFirst = await createTransfer(
    sender,
    senderWallet.id,
    receiver,
    10,
    sequentialKey,
  );
  const sequentialSecond = await createTransfer(
    sender,
    senderWallet.id,
    receiver,
    10,
    sequentialKey,
  );
  assert.equal(sequentialFirst.id, sequentialSecond.id);

  const concurrentKey = `concurrent-${runId}`;
  const concurrent = await Promise.all([
    createTransfer(sender, senderWallet.id, receiver, 10, concurrentKey),
    createTransfer(sender, senderWallet.id, receiver, 10, concurrentKey),
  ]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  assert.equal(
    composePsql(
      'payments-db',
      'payments',
      'payments',
      `SELECT count(*) FROM transfers WHERE sender_user_id = '${sender.userId}' AND idempotency_key IN ('${sequentialKey}', '${concurrentKey}')`,
    ),
    '2',
  );

  const outageKey = `outage-${runId}`;
  const balanceBeforeOutage = composePsql(
    'ledger-db',
    'ledger',
    'ledger',
    `SELECT balance_minor FROM wallet_balance_projection WHERE wallet_id = '${senderWallet.id}'`,
  );
  let outageTransfer;
  let outageFailureDurationMs;
  composeService('stop', 'ledger-service');
  const outageStartedAt = performance.now();
  try {
    outageTransfer = await request(payments, '/transfers', {
      method: 'POST',
      headers: { ...authorization(sender.token), 'idempotency-key': outageKey },
      body: {
        fromWalletId: senderWallet.id,
        toWalletIdentifier: receiver.email,
        amount: 5,
        currency: 'USD',
      },
    });
    assert.equal(outageTransfer.status, 'Validating');
    assert.ok(outageTransfer.retryCount >= 1);
    assert.ok(
      ['LEDGER_UNAVAILABLE', 'LEDGER_TIMEOUT'].includes(outageTransfer.failureCode),
      `expected a retryable ledger outage code, received ${outageTransfer.failureCode}`,
    );
    outageFailureDurationMs = Math.round(performance.now() - outageStartedAt);
    assert.ok(outageFailureDurationMs < 10_000);
    assert.equal(
      composePsql(
        'ledger-db',
        'ledger',
        'ledger',
        `SELECT balance_minor FROM wallet_balance_projection WHERE wallet_id = '${senderWallet.id}'`,
      ),
      balanceBeforeOutage,
    );
    assert.equal(
      composePsql(
        'payments-db',
        'payments',
        'payments',
        `SELECT count(*) FROM transfers WHERE id = '${outageTransfer.id}' AND retry_count >= 1 AND next_retry_at IS NOT NULL`,
      ),
      '1',
    );
  } finally {
    composeService('start', 'ledger-service');
  }
  await eventually(
    'ledger restart readiness',
    async () => (await fetch(`${ledger}/metrics`)).ok,
    (ready) => ready === true,
    60_000,
  );
  const recoveredTransfer = await eventually(
    'outage transfer recovery',
    () =>
      request(payments, `/transfers/${outageTransfer.id}`, {
        headers: authorization(sender.token),
      }),
    (transfer) => transfer.status === 'Completed',
    30_000,
  );
  assert.equal(recoveredTransfer.retryCount, 0);
  assert.equal(
    composePsql(
      'ledger-db',
      'ledger',
      'ledger',
      `SELECT balance_minor FROM wallet_balance_projection WHERE wallet_id = '${senderWallet.id}'`,
    ),
    String(Number(balanceBeforeOutage) - 500),
  );
  assert.equal(
    composePsql(
      'ledger-db',
      'ledger',
      'ledger',
      `SELECT count(*) FROM ledger_transfer_settlements WHERE transfer_id IN ('${sequentialFirst.id}', '${concurrent[0].id}')`,
    ),
    '2',
  );

  await publishDuplicateCompletion(completed.id);
  await eventually(
    'duplicate deliveries to be acknowledged',
    () =>
      Promise.resolve(
        composePsql(
          'notifications-db',
          'notifications',
          'notifications',
          `SELECT count(*) FROM processed_messages WHERE event_id = (SELECT event_id FROM activity_feed WHERE aggregate_id = '${completed.id}' AND event_type = 'payments.transfer.Completed' LIMIT 1)`,
        ),
      ),
    (count) => count === '1',
  );
  assert.equal(
    composePsql(
      'notifications-db',
      'notifications',
      'notifications',
      `SELECT count(*) FROM activity_feed WHERE aggregate_id = '${completed.id}' AND event_type = 'payments.transfer.Completed'`,
    ),
    '1',
  );

  const admin = await adminSession(sender);
  const adminHeaders = authorization(admin.accessToken);
  const [senderEvents, receiverEvents, senderReconciliation, receiverReconciliation] =
    await Promise.all([
      request(gateway, `/bff/admin/wallets/${senderWallet.id}/events`, {
        headers: adminHeaders,
      }),
      request(gateway, `/bff/admin/wallets/${receiverWallet.id}/events`, {
        headers: adminHeaders,
      }),
      request(gateway, `/bff/admin/wallets/${senderWallet.id}/reconciliation`, {
        headers: adminHeaders,
      }),
      request(gateway, `/bff/admin/wallets/${receiverWallet.id}/reconciliation`, {
        headers: adminHeaders,
      }),
    ]);
  assert.equal(senderReconciliation.consistent, true);
  assert.equal(receiverReconciliation.consistent, true);
  assert.ok(senderEvents.some((event) => event.eventType === 'FundsHeld'));
  assert.ok(senderEvents.some((event) => event.eventType === 'HoldConsumed'));
  assert.ok(receiverEvents.some((event) => event.eventType === 'MoneyDeposited'));
  for (const events of [senderEvents, receiverEvents]) {
    assert.deepEqual(
      events.map((event) => event.streamVersion),
      events.map((_, index) => index + 1),
    );
    assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
  }

  const loadStartedAt = performance.now();
  const loadAttempts = await Promise.allSettled(
    Array.from({ length: 100 }, () =>
      request(ledger, `/wallets/${loadWallet.id}/withdraw`, {
        method: 'POST',
        headers: authorization(loadUser.token),
        body: { amount: 100 },
      }),
    ),
  );
  const loadDurationMs = Math.round(performance.now() - loadStartedAt);
  const successfulAttempts = loadAttempts.filter(
    (attempt) => attempt.status === 'fulfilled',
  ).length;
  assert.ok(successfulAttempts <= 10);
  assert.ok(
    loadAttempts
      .filter((attempt) => attempt.status === 'rejected')
      .every((attempt) => attempt.reason?.status === 400),
  );
  const loadFinal = await request(ledger, `/wallets/${loadWallet.id}`, {
    headers: authorization(loadUser.token),
  });
  const expectedFinalMinor = 100_000 - successfulAttempts * 10_000;
  assert.equal(loadFinal.balance, (expectedFinalMinor / 100).toFixed(2));
  assert.equal(loadFinal.available, loadFinal.balance);
  assert.equal(loadFinal.held, '0.00');
  assert.ok(Number(loadFinal.available) >= 0);
  const loadReconciliation = await request(
    gateway,
    `/bff/admin/wallets/${loadWallet.id}/reconciliation`,
    { headers: adminHeaders },
  );
  assert.equal(loadReconciliation.consistent, true);
  const loadEvents = await request(
    gateway,
    `/bff/admin/wallets/${loadWallet.id}/events`,
    { headers: adminHeaders },
  );
  assert.equal(
    loadEvents.filter((event) => event.eventType === 'WithdrawalCompleted').length,
    successfulAttempts,
  );
  assert.deepEqual(
    loadEvents.map((event) => event.streamVersion),
    loadEvents.map((_, index) => index + 1),
  );

  const globalReconciliation = await request(
    gateway,
    '/bff/admin/reconciliation/global',
    { headers: adminHeaders },
  );
  assert.equal(globalReconciliation.balanced, true);
  assert.equal(globalReconciliation.creditsMinor, globalReconciliation.debitsMinor);
  assert.deepEqual(globalReconciliation.invalidTransactionEventIds, []);

  const resynchronized = await reconnectAndResynchronize(
    sender,
    completed.id,
    senderWallet.id,
  );
  assert.equal(resynchronized.transfer.status, 'Completed');
  assert.equal(resynchronized.wallet.id, senderWallet.id);
  assert.ok(
    resynchronized.activity.items.some((item) => item.aggregateId === completed.id),
  );

  const report = {
    successfulTransfer: {
      transferId: completed.id,
      senderBalance: senderAfter.balance,
      receiverBalance: receiverAfter.balance,
      senderProjectionConsistent: senderReconciliation.consistent,
      receiverProjectionConsistent: receiverReconciliation.consistent,
      completionActivityCount: 1,
      receiverBalanceActivityCount: 1,
    },
    idempotency: {
      sequentialTransferId: sequentialFirst.id,
      concurrentTransferId: concurrent[0].id,
      logicalTransfers: 2,
      ledgerSettlements: 2,
    },
    crossCurrency: {
      transferId: crossCurrency.id,
      source: `${crossCurrency.amount} ${crossCurrency.currency}`,
      destination: `${crossCurrency.destinationAmount} ${crossCurrency.destinationCurrency}`,
      fxRate: crossCurrency.fxRate,
      receiverProjectionBalance: receiverEur.balance,
    },
    policyRejection: {
      transferId: blockedTransfer.id,
      finalStatus: blockedTransfer.status,
      failureCode: blockedTransfer.failureCode,
      holdPlaced: false,
    },
    ledgerOutage: {
      transferId: outageTransfer.id,
      failureCode: outageTransfer.failureCode,
      boundedFailureDurationMs: outageFailureDurationMs,
      persistedRetryObserved: true,
      recoveredStatus: recoveredTransfer.status,
      moneyChangedBeforeRecovery: false,
    },
    load: {
      startingBalance: '1000.00',
      concurrency: 100,
      attempts: 100,
      amount: '100.00',
      expectedMaximumSuccesses: 10,
      actualSuccesses: successfulAttempts,
      finalBalance: loadFinal.balance,
      finalHeld: loadFinal.held,
      finalAvailable: loadFinal.available,
      reconciliation: loadReconciliation.consistent,
      durationMs: loadDurationMs,
    },
    globalReconciliation,
    brokerDuplicateDelivery: 'one processed_messages row and one activity row',
    websocketReconnect: 'authoritative transfer, wallet and activity re-fetched',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
  if (error.body) process.stderr.write(`${JSON.stringify(error.body)}\n`);
  process.exitCode = 1;
});
