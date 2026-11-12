import mongoose from 'mongoose';
import {
  initializeLearningIndexes,
  learningStorageReady,
} from '../learning/repository.js';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import { initializeAuthIndexes, authStorageReady } from '../auth/repository.js';
import {
  initializeAdminIndexes,
  adminStorageReady,
} from '../administration/repository.js';
mongoose.set('bufferCommands', false);
import {
  initializeStudentIndexes,
  studentStorageReady,
} from '../students/repository.js';
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
  await initializeAdminIndexes();
  await initializeStudentIndexes();
  await initializeLearningIndexes();
  logger.info('Database connected');
}
export async function databaseReady() {
  if (
    !authStorageReady() ||
    !adminStorageReady() ||
    !studentStorageReady() ||
    !learningStorageReady()
  )
    return false;
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
