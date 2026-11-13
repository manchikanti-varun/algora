'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { SignOutButtons } from '@/features/auth/sign-out';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdministration } from '@/features/administration/queries';
import { apiMutate, ApiError } from '@/lib/api/client';
import { QueryState, Status } from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import {
  detailSchema,
  basePath,
  dayLabel,
  scanResponse,
  type ScanResult,
} from './contracts';
import { AttendanceCounts } from './shared';
const Camera = dynamic(() => import('./camera'), {
  ssr: false,
  loading: () => <p>Preparing camera…</p>,
});
export function AttendanceScanner({
  batchId,
  sessionId,
  superAdmin = false,
}: {
  batchId: string;
  sessionId: string;
  superAdmin?: boolean;
}) {
  const base = basePath(batchId) + '/sessions/' + sessionId,
    prefix = superAdmin ? '/super-admin' : '/admin';
  const q = useAdministration(base, detailSchema),
    client = useQueryClient();
  const [active, setActive] = useState(false),
    [paused, setPaused] = useState(false),
    [cameraError, setCameraError] = useState(''),
    [message, setMessage] = useState(''),
    [result, setResult] = useState<ScanResult | null>(null),
    [recent, setRecent] = useState<ScanResult[]>([]),
    [busy, setBusy] = useState(false),
    [renew, setRenew] = useState(false);
  const inFlight = useRef(false),
    last = useRef({ hash: '', time: 0 }),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    const stop = () => {
      if (document.hidden) setActive(false);
    };
    document.addEventListener('visibilitychange', stop);
    return () => {
      live.current = false;
      last.current = { hash: '', time: 0 };
      document.removeEventListener('visibilitychange', stop);
    };
  }, []);
  const scanned = useCallback(
    async (credential: string) => {
      if (
        inFlight.current ||
        !active ||
        paused ||
        q.data?.session.status !== 'OPEN'
      )
        return;
      if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) {
        setMessage('Invalid QR. Show the permanent Algora QR credential.');
        setResult(null);
        return;
      }
      inFlight.current = true;
      setBusy(true);
      try {
        const bytes = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(credential),
          ),
          hash = Array.from(new Uint8Array(bytes), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join('');
        if (last.current.hash === hash && Date.now() - last.current.time < 4000)
          return;
        last.current = { hash, time: Date.now() };
        const data = await apiMutate(base + '/scan', 'POST', scanResponse, {
          credential,
        });
        if (!live.current) return;
        setResult(data);
        setMessage(
          data.outcome === 'MARKED'
            ? 'Attendance recorded'
            : 'Already marked — no duplicate record',
        );
        if (data.outcome === 'MARKED')
          setRecent((rows) => [data, ...rows].slice(0, 6));
        void client.invalidateQueries({ queryKey: ['administration'] });
      } catch (e) {
        if (!live.current) return;
        setResult(null);
        if (
          e instanceof ApiError &&
          e.code === 'SCANNER_SESSION_RENEWAL_REQUIRED'
        )
          setRenew(true);
        const errors: Record<string, string> = {
          INVALID_OR_REVOKED_QR:
            'Invalid or revoked QR. Ask the student to show their current credential.',
          REVOKED_QR: 'Revoked QR. Show the current credential.',
          ENROLLMENT_REQUIRED:
            'Student not currently eligible or enrolled in this Batch.',
          STUDENT_NOT_VERIFIED: 'Student identity is not verified.',
          WRONG_COLLEGE: 'QR is not eligible for this College.',
          SESSION_CLOSED: 'Session closed. Scanning has stopped.',
          ROSTER_REFRESH_REQUIRED:
            'Eligible member is not in the roster. Review roster additions first.',
          DAY_RESTRICTED:
            'Learning Day access is restricted. Scanning has stopped.',
          NETWORK_ERROR:
            'Network error. Attendance was not confirmed; retry the scan.',
        };
        setMessage(
          e instanceof ApiError
            ? (errors[e.code] ?? e.message)
            : 'Attendance was not confirmed. Try again.',
        );
        if (
          e instanceof ApiError &&
          ([401, 403].includes(e.status) ||
            [
              'SESSION_CLOSED',
              'DAY_RESTRICTED',
              'SCANNER_SESSION_RENEWAL_REQUIRED',
            ].includes(e.code))
        )
          setActive(false);
      } finally {
        inFlight.current = false;
        if (live.current) setBusy(false);
      }
    },
    [active, paused, q.data?.session.status, base, client],
  );
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={prefix + '/batches/' + batchId + '/attendance'}>
          Attendance
        </Link>{' '}
        /{' '}
        <Link
          href={prefix + '/batches/' + batchId + '/attendance/' + sessionId}
        >
          Review session
        </Link>{' '}
        / Scanner
      </nav>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <header className="attendance-heading">
              <div>
                <span className="eyebrow">
                  {dayLabel(q.data.session.dayNumber)} ·{' '}
                  {q.data.session.sessionType}
                </span>
                <h2>{q.data.session.dayTitle}</h2>
                <Status value={q.data.session.status} />
              </div>
              <p>
                QR copies can be shared. Authorized scanning checks eligibility;
                it does not independently prove physical presence.
              </p>
            </header>
            <div className="attendance-scanner-layout">
              <section className="student-card">
                <div className="student-actions">
                  {renew && (
                    <div>
                      <p>
                        Sign out and sign in again to renew scanning access.
                      </p>
                      <SignOutButtons />
                    </div>
                  )}
                  {!active ? (
                    <Button
                      disabled={q.data.session.status !== 'OPEN'}
                      onClick={() => {
                        if (
                          !window.isSecureContext ||
                          !navigator.mediaDevices?.getUserMedia
                        ) {
                          setCameraError(
                            'Camera unavailable. Use HTTPS or localhost with a supported browser.',
                          );
                          return;
                        }
                        setCameraError('');
                        setMessage('Ready to scan');
                        setActive(true);
                        setPaused(false);
                      }}
                    >
                      Start camera
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => setPaused((v) => !v)}>
                        {paused ? 'Resume scanning' : 'Pause scanning'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setActive(false)}
                      >
                        Stop camera
                      </Button>
                    </>
                  )}
                </div>
                {q.data.session.status !== 'OPEN' && (
                  <p role="status">Scanning requires an OPEN session.</p>
                )}
                {active && q.data.session.status === 'OPEN' && !q.error && (
                  <Camera
                    paused={paused}
                    onScan={(value) => void scanned(value)}
                    onError={() => {
                      setCameraError(
                        'Camera access failed. Check permission, camera availability and HTTPS, then retry.',
                      );
                      setActive(false);
                    }}
                  />
                )}
                {cameraError && <p role="alert">{cameraError}</p>}
                <div
                  className={
                    'attendance-feedback ' +
                    (result?.outcome === 'MARKED' ? 'success' : '')
                  }
                  role="status"
                  aria-live="polite"
                >
                  <strong>
                    {busy
                      ? 'Checking current eligibility…'
                      : message || 'Camera stopped'}
                  </strong>
                  {result && (
                    <p>
                      {result.student.name} · {result.student.rollNumber}
                    </p>
                  )}
                </div>
              </section>
              <aside className="student-card">
                <h2>Live session</h2>
                <AttendanceCounts counts={q.data.counts} />
                <p>
                  Hold one QR inside the frame. The camera continues after each
                  response. Unscanned members remain unmarked until
                  finalization.
                </p>
                <h3>Recent successful scans</h3>
                {recent.length ? (
                  <ol>
                    {recent.map((r, i) => (
                      <li key={i}>
                        {r.student.name} · {r.student.rollNumber}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No confirmed scans in this scanner view yet.</p>
                )}
              </aside>
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}
