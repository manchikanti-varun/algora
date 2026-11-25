/** Minimal HTTP transport so adapters can run against a real network or a deterministic mock. */
export interface HttpRequest { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal }
export interface HttpResponse { status: number; headers: { get(name: string): string | null }; text(): Promise<string> }
export interface HttpTransport { kind: 'network' | 'mock'; send(req: HttpRequest): Promise<HttpResponse> }

export const networkTransport = (): HttpTransport => ({
  kind: 'network',
  send: async (r) => {
    const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body, signal: r.signal, redirect: 'manual' });
    return { status: res.status, headers: res.headers, text: () => res.text() };
  },
});

/** Shared identification for every outbound request. LeetCode can see who we are and reach us. */
export const userAgent = (contact?: string) => `AlgoraSync/1.0${contact ? ` (+${contact})` : ''}`;
