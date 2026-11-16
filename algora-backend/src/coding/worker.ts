import { env } from '../config/env.js';
import { mongoProgressRepository, codingStorageReady } from './repository.js';
import { mongoLearningRepository } from '../learning/repository.js';
import { LearningService } from '../learning/service.js';
import { CodingService } from './service.js';
import { logger } from '../utils/logger.js';
export function startCodingWorker() {
  const service = new CodingService(
    mongoProgressRepository,
    new LearningService(mongoLearningRepository),
  );
  let running = false,
    stopping = false,
    lastSchedule = 0;
  const tick = async () => {
    if (
      running ||
      stopping ||
      !codingStorageReady() ||
      env.CODING_SYNC_ENABLED !== 'true'
    )
      return;
    running = true;
    try {
      if (Date.now() - lastSchedule > 60000) {
        lastSchedule = Date.now();
        await service.schedule();
      }
      if (!stopping) await service.processOne();
    } catch {
      logger.warn('Coding sync unavailable; durable jobs will retry');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 3500);
  timer.unref();
  return () => {
    stopping = true;
    clearInterval(timer);
  };
}
