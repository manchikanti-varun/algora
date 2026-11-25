import { z } from 'zod';
import { Setting } from '../../models';

export const scoringSchema = z.object({ EASY: z.number().int().min(0).max(1000), MEDIUM: z.number().int().min(0).max(1000), HARD: z.number().int().min(0).max(1000) }).strict();
export type Scoring = z.infer<typeof scoringSchema>;
export const DEFAULT_SCORING: Scoring = { EASY: 10, MEDIUM: 20, HARD: 30 };

export async function getScoring(): Promise<Scoring> {
  const s = await Setting.findById('scoring').lean();
  const p = scoringSchema.safeParse(s?.value);
  return p.success ? p.data : DEFAULT_SCORING;
}
