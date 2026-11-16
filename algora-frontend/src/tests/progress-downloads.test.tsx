import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { ReportDownloads } from '@/features/coding/report-downloads';
const state = { error: '', pending: false };
let finish: (value: Response) => void;
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { success: true, data }
        : { error: { code: state.error, message: 'Export failed' } },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
const file = () =>
  response({
    filename: 'Algora_Batch_Complete_Report.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: btoa('test file'),
    rowCount: 120,
  });
beforeEach(() => {
  state.error = '';
  state.pending = false;
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/csrf'))
        return response({ csrfToken: 'csrf' });
      if (state.pending)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (state.error)
        return response(
          null,
          state.error === 'EXPORT_TOO_LARGE'
            ? 413
            : state.error === 'NO_REPORT_DATA'
              ? 404
              : state.error === 'FORBIDDEN'
                ? 403
                : 503,
        );
      return file();
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('provides five report types and visible Excel/CSV downloads', () => {
  render(<ReportDownloads batchId="batch" filters={{}} />);
  expect(screen.getAllByRole('option')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'Download Excel' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
});
it.each(['DAY', 'PROBLEM', 'STUDENT', 'BATCH', 'COMPLETE'])(
  'sends %s report filters without visible pagination',
  async (type) => {
    render(
      <ReportDownloads
        batchId="batch"
        filters={{
          page: 4,
          pageSize: 10,
          assignmentPage: 3,
          day: 100,
          platform: 'CODEFORCES',
          verification: 'VERIFIED',
          from: '2030-01-01T00:00:00Z',
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Report type'), {
      target: { value: type },
    });
    fireEvent.change(screen.getByLabelText('Report Student name'), {
      target: { value: 'Example' },
    });
    fireEvent.change(screen.getByLabelText('Report Student roll number'), {
      target: { value: 'R000000001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await screen.findByText(/Download ready/);
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/export'))!;
    const body = JSON.parse(String(call[1]?.body));
    expect(body).toMatchObject({
      reportType: type,
      format: 'XLSX',
      confirmed: true,
      filters: {
        day: 100,
        platform: 'CODEFORCES',
        verification: 'VERIFIED',
        studentName: 'Example',
        rollNumber: 'R000000001',
      },
    });
    expect(body.filters).not.toHaveProperty('page');
    expect(body.filters).not.toHaveProperty('assignmentPage');
    expect(call[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
  },
);
it('prepares a CSV download without pretending it has worksheets', async () => {
  render(<ReportDownloads batchId="batch" filters={{}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  await screen.findByText(/Download ready/);
  expect(
    screen.getByText(/Complete CSV is one flat assignment-detail file/),
  ).toBeInTheDocument();
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).endsWith('/export'))!;
  expect(JSON.parse(String(call[1]?.body)).format).toBe('CSV');
});
it('requires a selected Learning Day before issuing a Day report', async () => {
  render(<ReportDownloads batchId="batch" filters={{}} />);
  fireEvent.change(screen.getByLabelText('Report type'), {
    target: { value: 'DAY' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose a Learning Day',
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('does not claim download readiness while generation is pending', async () => {
  state.pending = true;
  render(<ReportDownloads batchId="batch" filters={{}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
  expect(
    await screen.findByText('Generating complete report…'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Download ready/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  finish(file());
  expect(await screen.findByText(/Download ready/)).toBeInTheDocument();
});
it.each([
  ['EXPORT_TOO_LARGE', 'Export too large'],
  ['NO_REPORT_DATA', 'No matching records'],
  ['FORBIDDEN', 'Permission denied'],
  ['UNAVAILABLE', 'Export failed'],
])('handles %s with retry and no fake success', async (code, message) => {
  state.error = code;
  render(<ReportDownloads batchId="batch" filters={{}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Retry download' })).toBeEnabled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  state.error = '';
  fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Download ready'),
  );
});
it('allows an optional problem-by-Student breakdown', async () => {
  render(<ReportDownloads batchId="batch" filters={{}} />);
  fireEvent.change(screen.getByLabelText('Report type'), {
    target: { value: 'PROBLEM' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  await screen.findByText(/Download ready/);
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).endsWith('/export'))!;
  expect(JSON.parse(String(call[1]?.body)).includeDetails).toBe(true);
});
