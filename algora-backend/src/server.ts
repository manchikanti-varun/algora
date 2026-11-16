import {
  permanentDatabaseFailure,
  startupRetryDelay,
} from './operations/database.js';
import { startCodingWorker } from './coding/worker.js';
const stopCoding = startCodingWorker();
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { logger } from './utils/logger.js';
import { startReconciliationWorker } from './learning/worker.js';
const stopReconciliation = startReconciliationWorker();
const server = createApp().listen(env.PORT, '0.0.0.0', () =>
  logger.info({ port: env.PORT }, 'HTTP server started'),
);
let stopping = false;
let retryWait: (() => void) | undefined;
async function connect() {
  let attempt = 0;
  while (!stopping) {
    try {
      await connectDatabase();
      return;
    } catch (error) {
      await disconnectDatabase().catch(() => undefined);
      if (stopping) return;
      if (permanentDatabaseFailure(error)) {
        logger.fatal(
          'Database authorization, transaction or index conflict requires operator repair',
        );
        return;
      }
      const delay = startupRetryDelay(attempt++);
      logger.warn(
        { retryDelayMs: delay },
        'Database unavailable; retry scheduled',
      );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        timer.unref();
        retryWait = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }
}
void connect();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  retryWait?.();
  const workers = Promise.all([stopReconciliation(), stopCoding()]);
  logger.info('Shutting down');
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  server.close(() => {
    void (async () => {
      await workers;
      await disconnectDatabase();
      clearTimeout(deadline);
      process.exit(0);
    })().catch(() => {
      logger.error('Shutdown could not complete');
      process.exit(1);
    });
  });
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
server.on('error', () => {
  logger.fatal('HTTP server failed');
  process.exit(1);
});
