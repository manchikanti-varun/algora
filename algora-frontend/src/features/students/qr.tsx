'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import QRCode from 'qrcode';
import Image from 'next/image';
import { apiGet, apiMutate } from '@/lib/api/client';
import { useAdministration } from '@/features/administration/queries';
import { useAuth } from '@/features/auth/provider';
import { QueryState, Status, Confirmation } from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { StudentShell } from './shell';
import { meStudentSchema } from './contracts';
export function StudentQr() {
  const auth = useAuth();
  const q = useAdministration('/students/me', meStudentSchema);
  const [image, setImage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  function clear() {
    generation.current++;
    controller.current?.abort();
    setImage('');
  }
  useEffect(() => {
    const pending = controller;
    return () => {
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (auth.error || !auth.user) {
      generation.current++;
      controller.current?.abort();
    }
  }, [auth.error, auth.user]);
  async function reveal() {
    clear();
    const current = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      const credential = await apiGet(
        '/students/me/qr',
        z.object({
          token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          version: z.number(),
        }),
        abort.signal,
      );
      const png = await QRCode.toDataURL(credential.token, {
        width: 640,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#152c25', light: '#ffffff' },
      });
      if (current === generation.current && !abort.signal.aborted)
        setImage(png);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : 'QR unavailable');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function rotate() {
    clear();
    setBusy(true);
    setError('');
    try {
      await apiMutate(
        '/students/me/qr/rotate',
        'POST',
        z.object({ version: z.number() }),
        {
          expectedVersion: q.data?.profile.qrCredentialVersion,
          confirmed: true,
        },
      );
      setConfirm(false);
      await q.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rotation failed');
    } finally {
      setBusy(false);
    }
  }
  const canDisplay = !!auth.user && !auth.error;
  return (
    <StudentShell
      title="One identity. One QR."
      description="Your private, permanent identity credential. Display it only when you choose."
    >
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <section className="student-card student-qr">
            <Status value={q.data.profile.verificationStatus} />
            <h2>{q.data.profile.fullName}</h2>
            <p>
              {q.data.profile.studentUsername}
              <br />
              {q.data.college?.name ?? 'College unavailable'}
            </p>
            <p>
              Credential{' '}
              {q.data.profile.qrCredentialVersion
                ? 'active · version ' + q.data.profile.qrCredentialVersion
                : 'not issued'}
            </p>
            {image && canDisplay ? (
              <>
                <Image
                  src={image}
                  unoptimized
                  alt="Private student QR credential"
                  width={320}
                  height={320}
                />
                <a href={image} download="algora-student-qr.png">
                  Download QR as PNG
                </a>
                <Button variant="outline" onClick={clear}>
                  Hide QR
                </Button>
              </>
            ) : (
              <div className="student-notice">
                QR hidden. Your credential is retrieved only when you select
                Display QR.
              </div>
            )}
            <div className="student-actions">
              <Button
                onClick={() => void reveal()}
                disabled={
                  busy ||
                  !q.data.profile.qrCredentialVersion ||
                  !q.data.qrIssuanceAvailable
                }
              >
                Display QR
              </Button>
              <Button
                variant="outline"
                onClick={() => setConfirm(true)}
                disabled={busy || !q.data.qrIssuanceAvailable}
              >
                {q.data.profile.qrCredentialVersion
                  ? 'Rotate compromised QR'
                  : 'Issue QR'}
              </Button>
            </div>
            {!q.data.qrIssuanceAvailable && (
              <p role="status">
                QR encryption is unavailable. Your profile remains registered;
                an operator must configure the credential vault.
              </p>
            )}
            <p>
              Your QR contains an opaque credential, with no personal details.
              Keep the image private. It is an identity credential, not proof of
              attendance or permission to enroll. Rotation invalidates previous
              copies.
            </p>
            {busy && <p role="status">Working securely…</p>}
            {error && <p role="alert">{error}</p>}
          </section>
        )}
      </QueryState>
      <Confirmation
        open={confirm}
        title="Replace your QR credential?"
        description="All previous QR copies stop working immediately. Your name, roll number and permanent username stay unchanged."
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => void rotate()}
      />
    </StudentShell>
  );
}
