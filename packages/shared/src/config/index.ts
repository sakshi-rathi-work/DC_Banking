import { z } from 'zod';

export const CommonConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  JWT_SECRET: z.string().min(8).default('dev-dbs-jwt-secret-key-change-in-prod'),
  LAB_MODE: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('true'),
});

export type CommonConfig = z.infer<typeof CommonConfigSchema>;

export function loadConfig<T extends z.ZodTypeAny>(schema: T, source: Record<string, unknown> = process.env): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errorDetails}`);
  }
  return Object.freeze(result.data);
}
