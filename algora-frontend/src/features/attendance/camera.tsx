'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Scanner,
  useDevices,
  prepareZXingModule,
  type IScannerHandle,
} from '@yudiel/react-qr-scanner';
import { Field } from '@/components/shared/admin-ui';
prepareZXingModule({
  overrides: {
    locateFile: (path: string) =>
      path.endsWith('.wasm') ? '/scanner/zxing_reader.wasm' : path,
  },
});
export default function AttendanceCamera({
  paused,
  onScan,
  onError,
}: {
  paused: boolean;
  onScan: (value: string) => void;
  onError: (error: unknown) => void;
}) {
  const devices = useDevices(),
    [selected, setSelected] = useState(''),
    scanner = useRef<IScannerHandle>(null);
  useEffect(() => {
    const controller = scanner.current;
    return () => {
      controller
        ?.getStream()
        ?.getTracks()
        .forEach((track) => track.stop());
    };
  }, []);
  return (
    <>
      <Field label="Camera">
        <select
          aria-label="Attendance camera"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Prefer rear camera</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Camera ' + (i + 1)}
            </option>
          ))}
        </select>
      </Field>
      <div className="attendance-camera">
        <Scanner
          ref={scanner}
          key={selected}
          formats={['qr_code']}
          constraints={
            selected
              ? { deviceId: { exact: selected } }
              : { facingMode: { ideal: 'environment' } }
          }
          paused={paused}
          allowMultiple
          scanDelay={1500}
          sound={false}
          components={{ finder: true, torch: true }}
          onError={onError}
          onScan={(codes) => {
            if (codes[0]) onScan(codes[0].rawValue);
          }}
        />
      </div>
    </>
  );
}
