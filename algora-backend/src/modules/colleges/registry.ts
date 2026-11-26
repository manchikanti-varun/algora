import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import { badRequest, conflict } from '../../lib/errors';
import { nameKey } from '../../lib/normalize';
import { College } from '../../models';

const label = z.string().trim().min(2).max(120).transform((s) => s.normalize('NFKC').replace(/\s+/gu, ' '));
const code = z.string().trim().normalize('NFKC').toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/);
export const collegeFields = z.object({ name: label, code, aliases: z.array(label).max(30).default([]) }).strict();
export const collegePatch = collegeFields.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).strict();

export function collegeLabel(college?: { name?: string; code?: string | null } | null) {
  return college?.name && college.code ? `${college.name} [${college.code}]` : college?.name ?? null;
}

export function collegeSearch(q?: string) {
  if (!q) return {};
  const escaped = nameKey(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { $or: [{ searchKeys: { $regex: escaped } }, { nameKey: { $regex: escaped } }] };
}

export async function activeCollege(id: string, session?: ClientSession, lock = false) {
  const filter = { _id: id, status: 'ACTIVE' as const, code: { $type: 'string' as const } };
  // Transactional selections serialize with archival and merges.
  const college = lock && session
    ? await College.findOneAndUpdate(filter, { $inc: { selectionVersion: 1 } }, { session, timestamps: false }).lean()
    : await College.findOne(filter).session(session ?? null).lean();
  if (!college) throw badRequest('Select an active college. If yours is unavailable, contact your trainer or administrator.');
  return college;
}

export async function registryFields(input: { name: string; code?: string | null; aliases?: string[] }, excludeId?: string) {
  const aliases = [...new Map((input.aliases ?? []).map((a) => [nameKey(a), a])).values()];
  const searchKeys = [...new Set([input.name, input.code, ...aliases].filter((v): v is string => !!v).map(nameKey))];
  if (searchKeys.includes('')) throw badRequest('College names and aliases must contain searchable characters.');
  if (await College.exists({
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: [{ searchKeys: { $in: searchKeys } }, { nameKey: { $in: searchKeys } }],
  })) throw conflict('A college already uses that name, code or alias.', 'COLLEGE_CONFLICT');
  return { ...input, aliases, nameKey: nameKey(input.name), searchKeys };
}
