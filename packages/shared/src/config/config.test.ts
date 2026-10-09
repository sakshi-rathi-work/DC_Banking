import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { loadConfig, CommonConfigSchema } from './index.js';

describe('Config loading & validation', () => {
  it('loads valid common config with defaults', () => {
    const config = loadConfig(CommonConfigSchema, {});
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.LAB_MODE).toBe(true);
    expect(config.JWT_SECRET).toBe('dev-dbs-jwt-secret-key-change-in-prod');
  });

  it('correctly parses environment overrides', () => {
    const config = loadConfig(CommonConfigSchema, {
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
      LAB_MODE: 'false',
      JWT_SECRET: 'super-secret-key-12345',
    });
    expect(config.NODE_ENV).toBe('production');
    expect(config.LOG_LEVEL).toBe('debug');
    expect(config.LAB_MODE).toBe(false);
    expect(config.JWT_SECRET).toBe('super-secret-key-12345');
  });

  it('throws descriptive error on invalid config values', () => {
    const schema = z.object({
      PORT: z.coerce.number().min(1000),
    });
    expect(() => loadConfig(schema, { PORT: '10' })).toThrow('Configuration validation failed');
  });
});
