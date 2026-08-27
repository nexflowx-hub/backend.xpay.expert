import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required.');
}

export const dbPool = new Pool({
  connectionString,
  max: Number(process.env.XPAY_DB_POOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.XPAY_DB_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.XPAY_DB_CONNECT_TIMEOUT_MS ?? 10_000),
  ssl:
    process.env.XPAY_DB_SSL === 'false'
      ? false
      : { rejectUnauthorized: false }
});

export const withTransaction = async <T>(
  handler: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const oneOrNull = <T extends QueryResultRow>(
  rows: T[]
): T | null => rows[0] ?? null;
