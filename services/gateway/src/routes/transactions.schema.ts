import { z } from 'zod';

export const depositSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
  amountPaise: z.number().int('Amount must be an integer in paise').positive('Amount must be positive'),
  note: z.string().optional(),
});

export const withdrawSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
  amountPaise: z.number().int('Amount must be an integer in paise').positive('Amount must be positive'),
  note: z.string().optional(),
});

export const transferSchema = z.object({
  fromAccountId: z.string().uuid('Invalid source account ID'),
  toAccountNumber: z.string().length(12, 'Destination account number must be 12 digits'),
  amountPaise: z.number().int('Amount must be an integer in paise').positive('Amount must be positive'),
  note: z.string().optional(),
});

export const listTransactionsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER']).optional(),
  status: z.enum(['COMMITTED', 'REJECTED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export const getTransactionParamsSchema = z.object({
  id: z.string().uuid('Invalid transaction ID'),
});
