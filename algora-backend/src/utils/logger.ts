import pino from 'pino';
import { env } from '../config/env.js';
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    'MONGODB_URI',
    'GOOGLE_CLIENT_SECRET',
    'code',
    'id_token',
    'access_token',
    'refresh_token',
    'token',
    'tokenHash',
    'verifier',
    'nonce',
    'state',
    'cookie',
  ],
});
