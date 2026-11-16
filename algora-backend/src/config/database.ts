import {
  inspectDatabase,
  validateTransactions,
  ensureApplicationCollections,
} from '../operations/database.js';
import {
  initializeCodingIndexes,
  codingStorageReady,
} from '../coding/repository.js';
import {
  initializeAttendanceIndexes,
  attendanceStorageReady,
} from '../attendance/repository.js';
import {
  initializeCurriculumIndexes,
  curriculumStorageReady,
} from '../curriculum/repository.js';
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
mongoose.set('autoCreate', false);
let operationalReady = false;
mongoose.connection.on('disconnected', () => {
  operationalReady = false;
});
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
  operationalReady = false;
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    maxPoolSize: env.DB_MAX_POOL_SIZE,
    minPoolSize: 0,
    serverSelectionTimeoutMS: env.DB_SELECTION_TIMEOUT_MS,
    connectTimeoutMS: env.DB_SELECTION_TIMEOUT_MS,
    socketTimeoutMS: env.DB_SOCKET_TIMEOUT_MS,
    waitQueueTimeoutMS: env.DB_SELECTION_TIMEOUT_MS,
    maxIdleTimeMS: 60000,
  });
  await validateTransactions(mongoose.connection);
  await ensureApplicationCollections(mongoose.connection);
  await initializeAuthIndexes();
  await initializeAdminIndexes();
  await initializeStudentIndexes();
  await initializeLearningIndexes();
  await initializeCurriculumIndexes();
  await initializeAttendanceIndexes();
  await initializeCodingIndexes();
  const checks = await inspectDatabase(mongoose.connection);
  if (checks.some((c) => c.status !== 'PASS'))
    throw Object.assign(new Error('Database operational validation failed'), {
      code: checks.some(
        (c) => c.check === 'Required schema indexes' && c.status === 'FAIL',
      )
        ? 85
        : 91,
    });
  operationalReady = true;
  logger.info('Database connected and operational checks passed');
}
export async function databaseReady() {
  if (
    !operationalReady ||
    mongoose.connection.readyState !== 1 ||
    !authStorageReady() ||
    !adminStorageReady() ||
    !studentStorageReady() ||
    !learningStorageReady() ||
    !curriculumStorageReady() ||
    !codingStorageReady() ||
    !attendanceStorageReady()
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
  operationalReady = false;
  await mongoose.disconnect();
}
