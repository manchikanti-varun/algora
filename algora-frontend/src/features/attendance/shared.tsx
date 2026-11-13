'use client';
import { countsSchema } from './contracts';
import type { z } from 'zod';
export function AttendanceCounts({
  counts,
}: {
  counts: z.infer<typeof countsSchema>;
}) {
  return (
    <dl className="attendance-counts">
      {[
        ['Present', counts.present],
        ['Unmarked', counts.unmarked],
        ['Finalized absent', counts.absent],
        ['Excused', counts.excused],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
