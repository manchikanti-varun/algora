import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import { initializeAuthIndexes, authStorageReady } from '../auth/repository.js';
mongoose.set('bufferCommands', false);
mongoose.connection.on('error', () =>
  logger.error('Database connection error'),
);
mongoose.connection.on('disconnected', () =>
  logger.warn('Database disconnected'),
);
export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: 20,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
  });
  await initializeAuthIndexes();
  logger.info('Database connected');
}
export async function databaseReady() {
  if (!authStorageReady()) return false;
  try {
    await mongoose.connection.db!.admin().ping({ timeoutMS: 2000 });
    return true;
  } catch {
    return false;
  }
}
export async function disconnectDatabase() {
  await mongoose.disconnect();
}
