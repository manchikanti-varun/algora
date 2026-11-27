'use client';
import { Download, QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button, Card, Modal } from '@/components/ui';

/**
 * Student attendance QR. The payload is exactly the approved roll number, generated locally in the browser; no student
 * information is sent to any QR service. The code is always black on white (independent of the app theme) with a quiet
 * zone, so it scans reliably from a phone.
 */
export function AttendanceQr({ studentName, rollNumber }: { studentName: string; rollNumber: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const payload = rollNumber;
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 4, width: 640, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => { if (live) setDataUrl(url); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [rollNumber]);

  const download = () => {
    if (!dataUrl) return;
    const a = Object.assign(document.createElement('a'), { href: dataUrl, download: `algora-attendance-${rollNumber}.png` });
    document.body.appendChild(a); a.click(); a.remove();
  };

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
            <Button variant="ghost" size="sm" icon={<Download size={15} aria-hidden />} onClick={download} disabled={!dataUrl}>Download PNG</Button>
          </div>
          {failed && <p className="text-xs text-danger-fg">The QR image could not be generated. Your roll number is {rollNumber}.</p>}
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Attendance QR code" description="Have your trainer scan this code, or show it at the attendance desk.">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl border border-line bg-white p-4">
            {dataUrl && <img src={dataUrl} alt={`Attendance QR code for roll number ${rollNumber}`} width={320} height={320} className="h-80 w-80 max-w-full" />}
          </div>
          <p className="text-sm font-semibold tabular-nums text-fg">{rollNumber}</p>
          <p className="max-w-sm text-center text-[13px] text-fg-muted">{studentName} · {rollNumber}</p>
          <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} onClick={download} disabled={!dataUrl}>Download PNG</Button>
        </div>
      </Modal>
    </Card>
  );
}
