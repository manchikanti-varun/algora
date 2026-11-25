import { log } from '../../lib/logger';
import type { Request } from 'express';
import { AuditLog } from '../../models';

export async function audit(
  req: Request | null,
  action: string,
  target?: { type: string; id: unknown },
  metadata?: Record<string, unknown>,
  actor?: { _id: unknown; role: string },
) {
  try {
    const a = actor ?? (req as any)?.user;
    await AuditLog.create({
      actorId: a?._id,
      actorRole: a?.role,
      action,
      targetType: target?.type,
      targetId: target ? String(target.id) : undefined,
      metadata,
      ip: req?.ip,
    });
  } catch (e) {
    log.error('audit write failed', { action, error: e });
  }
}
