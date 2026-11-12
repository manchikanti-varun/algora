import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { apiGet, healthSchema } from '@/lib/api/client';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
afterEach(() => vi.unstubAllGlobals());
describe('shared UI', () => {
  it('renders accessible disabled buttons', () => {
    const click = vi.fn();
    render(
      <Button disabled onClick={click}>
        Continue
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });
  it('supports link composition', () => {
    render(
      <Button asChild>
        <a href="/login">Enter</a>
      </Button>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/login');
  });
  it('explains empty states', () => {
    render(
      <EmptyState title="Nothing yet" description="Features are planned" />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Nothing yet');
  });
  it('switches shell navigation without creating records', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { service: 'algora-backend', status: 'ok' },
          }),
        ),
      ),
    );
    render(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient()}>
          <DashboardShell role="student" />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'My Courses' }));
    expect(
      screen.getByRole('heading', { name: 'My Courses is on the horizon' }),
    ).toBeInTheDocument();
  });
});
describe('API client', () => {
  it('validates health and configured URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { service: 'algora-backend', status: 'ok' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect((await apiGet('/health', healthSchema)).status).toBe('ok');
    expect(fetcher.mock.calls[0][0]).toBe(
      'http://localhost:5000/api/v1/health',
    );
  });
  it('normalizes network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
    await expect(apiGet('/health', healthSchema)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
  it('rejects invalid payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(apiGet('/health', healthSchema)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('preserves structured API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'NOT_READY',
              message: 'Unavailable',
              requestId: 'test-id',
            },
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(apiGet('/ready', healthSchema)).rejects.toMatchObject({
      status: 503,
      code: 'NOT_READY',
      requestId: 'test-id',
    });
  });
});
