import type { Connection } from 'mongoose';
import { applicationModels } from './models.js';
import type { OperationalCheck } from './checks.js';
const stable = (v: unknown): string =>
  JSON.stringify(v, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
export function compatibleIndex(
  expected: {
    key: unknown;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: unknown;
    collation?: unknown;
  },
  actual: typeof expected,
) {
  return (
    JSON.stringify(expected.key) === JSON.stringify(actual.key) &&
    !!expected.unique === !!actual.unique &&
    !!expected.sparse === !!actual.sparse &&
    expected.expireAfterSeconds === actual.expireAfterSeconds &&
    stable(expected.partialFilterExpression ?? {}) ===
      stable(actual.partialFilterExpression ?? {}) &&
    stable(expected.collation ?? { locale: 'simple' }) ===
      stable(actual.collation ?? { locale: 'simple' })
  );
}
export async function validateTransactions(connection: Connection) {
  const session = await connection.startSession();
  try {
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: 2000,
    });
    await connection
      .db!.collection('users')
      .findOne({}, { session, projection: { _id: 1 }, maxTimeMS: 2000 });
    await session.commitTransaction();
  } finally {
    if (session.inTransaction()) await session.abortTransaction();
    await session.endSession();
  }
}
export async function inspectDatabase(
  connection: Connection,
): Promise<OperationalCheck[]> {
  const checks: OperationalCheck[] = [];
  try {
    await connection.db!.admin().ping({ timeoutMS: 2000 });
    checks.push({
      check: 'Database connection',
      status: 'PASS',
      guidance:
        'A bounded ping succeeded. This does not establish application lifecycle acceptance.',
    });
  } catch {
    return [
      {
        check: 'Database connection',
        status: 'BLOCKED',
        guidance:
          'Check network access, database credentials and Atlas allowlisting. No connection details are printed.',
      },
    ];
  }
  try {
    await validateTransactions(connection);
    checks.push({
      check: 'Transaction support',
      status: 'PASS',
      guidance:
        'A read-only snapshot transaction committed. No test user or application record was inserted.',
    });
  } catch {
    checks.push({
      check: 'Transaction support',
      status: 'FAIL',
      guidance:
        'Use a transaction-capable replica set or sharded deployment and review database permissions.',
    });
  }
  let valid = true;
  let unavailable = false;
  for (const model of applicationModels) {
    try {
      if (!model.schema.indexes().length) continue;
      const indexes = await connection
        .db!.collection(model.collection.name)
        .listIndexes({ maxTimeMS: 2000 })
        .toArray();
      for (const [key, options] of model.schema.indexes()) {
        const expected = {
          key,
          unique: !!options.unique,
          sparse: options.sparse,
          expireAfterSeconds: options.expireAfterSeconds,
          partialFilterExpression: options.partialFilterExpression,
          collation: options.collation,
        };
        if (!indexes.some((index) => compatibleIndex(expected, index)))
          valid = false;
      }
    } catch (error) {
      // NamespaceNotFound means a required collection/index is missing. A
      // transient metadata-read failure must not become a permanent conflict.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 26
      )
        valid = false;
      else unavailable = true;
    }
  }
  checks.push({
    check: 'Required schema indexes',
    status: !valid ? 'FAIL' : unavailable ? 'BLOCKED' : 'PASS',
    guidance:
      unavailable && valid
        ? 'Index metadata could not be read. Check connectivity and permissions before retrying.'
        : valid
          ? 'Declared keys and uniqueness, sparse, partial, TTL and collation options match.'
          : 'Review missing/conflicting schema indexes with a controlled migration. No indexes or collections were deleted or modified by preflight.',
  });
  return checks;
}
export function startupRetryDelay(attempt: number) {
  return Math.min(30000, 1000 * 2 ** Math.min(Math.max(0, attempt), 5));
}
export function permanentDatabaseFailure(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code
      : null;
  return [13, 18, 20, 85, 86, 11000, 303].includes(Number(code));
}

export async function ensureApplicationCollections(connection: Connection) {
  for (const model of applicationModels) {
    if (
      await connection
        .db!.listCollections(
          { name: model.collection.name },
          { nameOnly: true },
        )
        .hasNext()
    )
      continue;
    try {
      await connection.db!.createCollection(model.collection.name);
    } catch (error) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 48
      ))
        throw error;
    }
  }
}
