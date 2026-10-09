import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/integration/**/*.test.ts',
      'services/bank-node/src/bank/transactions.test.ts',
      'services/bank-node/src/replication/applier.test.ts',
      'services/bank-node/src/replication/catchup.test.ts',
    ],
    testTimeout: 30000,
  },
});
