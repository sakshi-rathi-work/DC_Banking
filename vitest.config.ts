import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'services/gateway/src/**/*.test.ts',
      'services/bank-node/src/bank/idempotency.test.ts',
      'services/bank-node/src/election/**/*.test.ts',
      'services/bank-node/src/replication/replicator.test.ts',
      'services/bank-node/src/clock/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      'tests/integration/**',
      'tests/distributed/**',
      'services/bank-node/src/bank/transactions.test.ts',
      'services/bank-node/src/replication/applier.test.ts',
      'services/bank-node/src/replication/catchup.test.ts',
    ],
    testTimeout: 10000,
  },
});
