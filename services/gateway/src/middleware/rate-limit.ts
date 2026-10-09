import rateLimit from 'express-rate-limit';
import { AppError } from '@bank/shared';

export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, _res, next) => {
    next(new AppError('RATE_LIMITED', 'Too many auth requests. Please try again later.'));
  },
});

export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, _res, next) => {
    next(new AppError('RATE_LIMITED', 'Too many requests. Please try again later.'));
  },
});
