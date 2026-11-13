// Automated test fixture only. Production uses MongoDB transactions and indexes.
import { UniqueConflict } from '../administration/contracts.js';
import { newId } from './administration-fixtures.js';
import { TestCurriculum } from './curriculum-fixtures.js';
import type {
  AttendanceRepository,
  AttendanceUnit,
  SessionRecord,
  AttendanceRow,
  RosterRow,
  History,
  List,
  Candidate,
} from '../attendance/contracts.js';
const copy = <T>(v: T): T => structuredClone(v);
export class TestAttendance implements AttendanceRepository {
  sessions = new Map<string, SessionRecord>();
  rows = new Map<string, AttendanceRow>();
  rosterRows = new Map<string, RosterRow>();
  events: History[] = [];
  constructor(public curriculum = new TestCurriculum()) {}
  ensureReady() {
    return this.curriculum.ensureReady();
  }
  async transaction<T>(work: (tx: AttendanceUnit) => Promise<T>) {
    return this.curriculum.transaction(async () => {
      const snapshot = copy({
          sessions: this.sessions,
          rows: this.rows,
          rosterRows: this.rosterRows,
          events: this.events,
        }),
        batches = copy(this.curriculum.attendanceBatches);
      try {
        return await work(this.read);
      } catch (e) {
        Object.assign(this, snapshot);
        this.curriculum.attendanceBatches = batches;
        throw e;
      }
    });
  }
  private page<T>(rows: T[], o: List) {
    return {
      items: copy(rows.slice((o.page - 1) * o.pageSize, o.page * o.pageSize)),
      total: rows.length,
      page: o.page,
      pageSize: o.pageSize,
      totalPages: Math.ceil(rows.length / o.pageSize),
    };
  }
  private stamp<T>(v: T) {
    return {
      ...copy(v),
      id: newId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  private filtered(batch: string, o: List) {
    return [...this.sessions.values()].filter(
      (s) =>
        s.batchId === batch &&
        (!o.dayId || s.learningDayId === o.dayId) &&
        (!o.sessionType || s.sessionType === o.sessionType) &&
        (!o.status || s.status === o.status) &&
        (!o.from || s.createdAt >= o.from) &&
        (!o.to || s.createdAt <= o.to),
    );
  }
  get read(): AttendanceUnit {
    return {
      curriculum: this.curriculum.read,
      ownBatches: async (profile, o) => {
        const ids = new Set(
            [...this.rosterRows.values()]
              .filter((r) => r.studentProfileId === profile)
              .map((r) => this.sessions.get(r.attendanceSessionId)?.batchId),
          ),
          rows = [...ids]
            .filter((id): id is string => !!id)
            .map((id) => {
              const s = [...this.sessions.values()].find(
                (s) => s.batchId === id,
              )!;
              return {
                id,
                name: s.batchName,
                college: s.collegeName,
                course: s.courseTitle,
              };
            });
        return this.page(rows, o);
      },
      sessions: async (b, o) => this.page(this.filtered(b, o), o),
      session: async (id) => copy(this.sessions.get(id) ?? null),
      insertSession: async (d) => {
        if (
          [...this.sessions.values()].some(
            (s) =>
              s.batchId === d.batchId &&
              s.learningDayId === d.learningDayId &&
              s.sessionType === d.sessionType,
          )
        )
          throw new UniqueConflict('sessionType');
        const s = this.stamp(d);
        this.sessions.set(s.id, s);
        this.curriculum.attendanceBatches.add(d.batchId);
        return copy(s);
      },
      changeSession: async (id, expected, status, patch) => {
        const s = this.sessions.get(id);
        if (!s || s.revision !== expected || s.status !== status) return null;
        Object.assign(s, copy(patch), { revision: expected + 1 });
        return copy(s);
      },
      lockSession: async (id, expected, status) => {
        const s = this.sessions.get(id);
        return !!s && s.revision === expected && s.status === status;
      },
      roster: async (id) =>
        copy(
          [...this.rosterRows.values()].filter(
            (r) => r.attendanceSessionId === id,
          ),
        ),
      addRoster: async (rows) => {
        for (const d of rows) {
          if (
            [...this.rosterRows.values()].some(
              (r) =>
                r.attendanceSessionId === d.attendanceSessionId &&
                r.studentProfileId === d.studentProfileId,
            )
          )
            throw new UniqueConflict('studentProfileId');
          const r = this.stamp(d);
          this.rosterRows.set(r.id, r);
        }
      },
      records: async (id) =>
        copy(
          [...this.rows.values()].filter((r) => r.attendanceSessionId === id),
        ),
      record: async (id) => copy(this.rows.get(id) ?? null),
      ownRecord: async (session, profile) =>
        copy(
          [...this.rows.values()].find(
            (r) =>
              r.attendanceSessionId === session &&
              r.studentProfileId === profile,
          ) ?? null,
        ),
      insertRecord: async (d) => {
        if (
          [...this.rows.values()].some(
            (r) =>
              r.attendanceSessionId === d.attendanceSessionId &&
              r.studentProfileId === d.studentProfileId,
          )
        )
          throw new UniqueConflict('studentProfileId');
        const r = this.stamp(d);
        this.rows.set(r.id, r);
        return copy(r);
      },
      updateRecord: async (id, expected, patch) => {
        const r = this.rows.get(id);
        if (
          !r ||
          r.revision !== expected ||
          this.sessions.get(r.attendanceSessionId)?.status !== 'FINALIZED'
        )
          return null;
        Object.assign(r, copy(patch), { revision: expected + 1 });
        return copy(r);
      },
      history: async (id, o) =>
        this.page(
          this.events.filter((e) => e.attendanceSessionId === id),
          o,
        ),
      addHistory: async (d) => {
        this.events.push(this.stamp(d));
      },
      candidates: async (batch) => {
        const items: Candidate[] = [];
        for (const e of this.curriculum.learning.enrollments.values()) {
          if (
            e.batchId !== batch ||
            e.status !== 'ACTIVE' ||
            !e.studentProfileId
          )
            continue;
          const profile = this.curriculum.learning.students.profiles.get(
            e.studentProfileId,
          );
          if (profile)
            items.push({ profile: copy(profile), enrollment: copy(e) });
        }
        return items;
      },
      credentialByHash: async (hash) => {
        const c = [
          ...this.curriculum.learning.students.credentials.values(),
        ].find((c) => c.tokenHash === hash);
        return c
          ? copy({
              profileId: c.profileId,
              version: c.version,
              tokenHash: c.tokenHash,
            })
          : null;
      },
      lockIdentity: async (p, e, hash) => {
        const real = this.curriculum.learning.students.profiles.get(p.id),
          link = this.curriculum.learning.enrollments.get(e.id),
          credential = this.curriculum.learning.students.credentials.get(p.id);
        return (
          !!real &&
          real.verificationStatus === 'VERIFIED' &&
          real.revision === p.revision &&
          real.qrCredentialVersion === p.qrCredentialVersion &&
          link?.status === 'ACTIVE' &&
          link.rollNumber === p.rollNumber &&
          link.revision === e.revision &&
          (!hash ||
            (credential?.tokenHash === hash &&
              credential.version === p.qrCredentialVersion))
        );
      },
      reportSessions: async (b, o) => copy(this.filtered(b, o)),
      ownSessions: async (b, p, o) =>
        this.page(
          this.filtered(b, o).filter((s) =>
            [...this.rosterRows.values()].some(
              (r) => r.attendanceSessionId === s.id && r.studentProfileId === p,
            ),
          ),
          o,
        ),
    };
  }
}
