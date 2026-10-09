import { z } from 'zod';

export const createAccountSchema = z.object({
  nickname: z.string().optional(),
});

export const lookupAccountSchema = z.object({
  accountNumber: z.string().length(12, 'Account number must be 12 digits'),
});

export const getAccountParamsSchema = z.object({
  id: z.string().uuid('Invalid account ID format'),
});

export const getStatementQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
