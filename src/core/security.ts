import type { SignOptions } from 'jsonwebtoken';

const jwtSecret = process.env.JWT_SECRET?.trim();

if (!jwtSecret) {
  throw new Error(
    'JWT_SECRET não configurado. A aplicação não pode iniciar.'
  );
}

if (jwtSecret.length < 64) {
  throw new Error(
    'JWT_SECRET deve possuir pelo menos 64 caracteres.'
  );
}

export const JWT_SECRET = jwtSecret;

export const JWT_EXPIRES_IN =
  (process.env.JWT_EXPIRES_IN?.trim() ||
    '24h') as SignOptions['expiresIn'];
