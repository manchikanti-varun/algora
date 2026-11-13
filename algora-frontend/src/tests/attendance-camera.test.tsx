import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { forwardRef, useImperativeHandle, useEffect } from 'react';
import AttendanceCamera from '@/features/attendance/camera';
const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  prepare: vi.fn(),
  props: null as null | {
    constraints: MediaTrackConstraints;
    paused: boolean;
    onScan: (items: { rawValue: string }[]) => void;
    onError: (e: unknown) => void;
    sound: boolean;
  },
}));
vi.mock('@yudiel/react-qr-scanner', () => ({
  prepareZXingModule: mocks.prepare,
  useDevices: () => [
    { deviceId: 'rear', label: 'Rear camera', kind: 'videoinput' },
  ],
  Scanner: forwardRef(function TestScanner(
    props: NonNullable<typeof mocks.props>,
    ref,
  ) {
    mocks.props = props;
    useImperativeHandle(ref, () => ({
      getStream: () => ({ getTracks: () => [{ stop: mocks.stop }] }),
    }));
    useEffect(() => () => mocks.stop(), []);
    return <div aria-label="Camera viewport" />;
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('prefers rear camera, disables sound and pauses without adding QR text to DOM', () => {
  render(<AttendanceCamera paused onScan={vi.fn()} onError={vi.fn()} />);
  expect(mocks.props?.constraints).toEqual({
    facingMode: { ideal: 'environment' },
  });
  expect(mocks.props?.paused).toBe(true);
  expect(mocks.props?.sound).toBe(false);
  expect(screen.queryByText('opaque-token')).not.toBeInTheDocument();
});
it('changes selected devices and stops old camera streams', () => {
  const { unmount } = render(
    <AttendanceCamera paused={false} onScan={vi.fn()} onError={vi.fn()} />,
  );
  fireEvent.change(screen.getByLabelText('Attendance camera'), {
    target: { value: 'rear' },
  });
  expect(mocks.props?.constraints).toEqual({ deviceId: { exact: 'rear' } });
  expect(mocks.stop).toHaveBeenCalled();
  unmount();
  expect(mocks.stop.mock.calls.length).toBeGreaterThan(1);
});
it('passes scans transiently to the authorized handler', () => {
  const onScan = vi.fn();
  render(<AttendanceCamera paused={false} onScan={onScan} onError={vi.fn()} />);
  mocks.props?.onScan([{ rawValue: 'opaque-token' }]);
  expect(onScan).toHaveBeenCalledWith('opaque-token');
  expect(screen.queryByText('opaque-token')).not.toBeInTheDocument();
});
