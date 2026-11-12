import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { logger } from './utils/logger.js';
const server = createApp().listen(env.PORT, '0.0.0.0', () =>
  logger.info({ port: env.PORT }, 'HTTP server started'),
);
let stopping = false;
async function connect() {
  while (!stopping) {
    try {
      await connectDatabase();
      return;
    } catch {
      logger.warn('Database unavailable; retrying in 5 seconds');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
void connect();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  logger.info('Shutting down');
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  server.close(async () => {
    await disconnectDatabase();
    clearTimeout(deadline);
    process.exit(0);
  });
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
server.on('error', () => {
  logger.fatal('HTTP server failed');
  process.exit(1);
});
