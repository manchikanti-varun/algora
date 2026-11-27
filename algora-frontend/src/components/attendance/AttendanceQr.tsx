'use client';
import { QrCode } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Button, Card, ErrorState, Modal } from '@/components/ui';
import { useApi } from '@/hooks/useApi';

/**
 * Student attendance QR. The payload is exactly the approved roll number, generated locally in the browser; no student
 * information is sent to any QR service. The code is always black on white (independent of the app theme) with a quiet
 * zone, so it scans reliably from a phone.
 */
function useAttendanceQr(rollNumber: string) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(rollNumber, { errorCorrectionLevel: 'M', margin: 4, width: 640, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => { if (live) setDataUrl(url); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [rollNumber]);

  return { dataUrl, failed };
}

function AttendanceQrDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return <Modal open={open} onClose={onClose} title="Attendance QR code" description="Show this code to your trainer to scan." wide>{children}</Modal>;
}

function EnlargedQr({ dataUrl, failed, rollNumber }: { dataUrl: string | null; failed: boolean; rollNumber: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      {dataUrl ? (
        <div className="max-w-full rounded-xl border border-line bg-white p-3">
          <img src={dataUrl} alt={`Attendance QR code for roll number ${rollNumber}`} width={640} height={640}
            className="h-auto w-[min(35rem,calc(100dvh-12rem))] max-w-full" />
        </div>
      ) : <p role="status" className="text-sm text-fg-muted">{failed ? 'QR image could not be generated.' : 'Generating QR code…'}</p>}
      <p className="text-sm font-semibold tabular-nums text-fg">{rollNumber}</p>
    </div>
  );
}

function ApprovedQr({ rollNumber }: { rollNumber: string }) {
  return <EnlargedQr rollNumber={rollNumber} {...useAttendanceQr(rollNumber)} />;
}

function CurrentAttendanceQr() {
  const { data, error, reload } = useApi<{ rollNumber: string }>('/student/attendance/qr');
  if (error) return <ErrorState message={error} retry={reload} />;
  if (!data) return <p role="status" className="text-sm text-fg-muted">Loading attendance QR…</p>;
  return <ApprovedQr key={data.rollNumber} rollNumber={data.rollNumber} />;
}

export function StudentAttendanceQrDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <AttendanceQrDialog open={open} onClose={onClose}>{open && <CurrentAttendanceQr />}</AttendanceQrDialog>;
}

export function AttendanceQr({ studentName, rollNumber }: { studentName: string; rollNumber: string }) {
  const { dataUrl, failed } = useAttendanceQr(rollNumber);
  const [open, setOpen] = useState(false);

  return (
    <Card title="Attendance QR code" description="Show this code to your trainer when attendance is taken.">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="shrink-0 rounded-xl border border-line bg-white p-3">
          {dataUrl
            ? <img src={dataUrl} alt={`Attendance QR code for roll number ${rollNumber}`} width={160} height={160} className="h-40 w-40" />
            : <div className="grid h-40 w-40 place-items-center text-xs text-black">{failed ? 'QR unavailable' : 'Generating…'}</div>}
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="font-medium text-fg">{studentName}</p>
          <p className="text-fg-muted">Roll number <span className="font-semibold tabular-nums text-fg">{rollNumber}</span></p>
          <p className="max-w-prose text-[13px] text-fg-muted">
            The code contains only your approved roll number. It identifies you to your trainer; it does not mark you present by itself.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="secondary" size="sm" icon={<QrCode size={15} aria-hidden />} onClick={() => setOpen(true)} disabled={!dataUrl}>View QR code</Button>
          </div>
          {failed && <p className="text-xs text-danger-fg">The QR image could not be generated. Your roll number is {rollNumber}.</p>}
        </div>
      </div>
      <AttendanceQrDialog open={open} onClose={() => setOpen(false)}>
        <EnlargedQr dataUrl={dataUrl} failed={failed} rollNumber={rollNumber} />
      </AttendanceQrDialog>
    </Card>
  );
}
