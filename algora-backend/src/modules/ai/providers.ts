import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIPv4 } from 'node:net';
import { AppError, badRequest } from '../../lib/errors';

export const providerNames = ['GROQ', 'GEMINI', 'OPENROUTER', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'MISTRAL', 'CUSTOM'] as const;
export type ProviderName = typeof providerNames[number];

const bases = {
  GROQ: 'https://api.groq.com/openai/v1', GEMINI: 'https://generativelanguage.googleapis.com/v1beta',
  OPENROUTER: 'https://openrouter.ai/api/v1', OPENAI: 'https://api.openai.com/v1', ANTHROPIC: 'https://api.anthropic.com/v1',
  DEEPSEEK: 'https://api.deepseek.com', MISTRAL: 'https://api.mistral.ai/v1',
};
export const customEndpoints = ['https://api.together.ai/v1', 'https://api.fireworks.ai/inference/v1'] as const;
export interface ProviderOptions {
  provider?: string | null; endpoint?: string | null; model?: string | null; timeoutMs?: number | null;
  outputMode?: string | null;
}
export const providerName = (value: ProviderOptions): ProviderName => {
  const name = value.provider ?? 'GROQ';
  if (!providerNames.includes(name as ProviderName)) throw badRequest('Unsupported AI provider.');
  return name as ProviderName;
};
export function providerBase(value: ProviderOptions) {
  const name = providerName(value);
  if (name !== 'CUSTOM') {
    if (value.endpoint) throw badRequest('This provider uses a fixed API endpoint.');
    return bases[name];
  }
  // Match the whole canonical base, including its path. No arbitrary host, path, port, query or userinfo.
  const base = value.endpoint?.replace(/\/$/, '');
  if (!(customEndpoints as readonly (string | undefined)[]).includes(base)) throw badRequest('Select an approved compatible API endpoint.');
  return base!;
}
export const providerIdentity = (value: ProviderOptions) => `${providerName(value)}:${providerBase(value)}`;
// For unknown quota scopes, every key for the same upstream service shares one conservative pool.
export const providerFamily = (value: ProviderOptions) => providerName(value) === 'CUSTOM' ? providerBase(value) : providerName(value);

const forbiddenAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) forbiddenAddresses.addSubnet(network, prefix, 'ipv4');
export const publicAddress = (address: string) => isIPv4(address) && !forbiddenAddresses.check(address, 'ipv4');

interface Reply { status: number; headers: Headers; body: unknown }
const maximumBytes = 1_000_000;

async function send(url: string, headers: Record<string, string>, timeout: number, custom: boolean, body?: unknown): Promise<Reply> {
  const signal = AbortSignal.timeout(timeout);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (!custom) {
    const response = await fetch(url, { method: payload === undefined ? 'GET' : 'POST', headers, body: payload, signal, redirect: 'error' });
    const reader = response.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > maximumBytes) throw new AppError(502, 'AI_OUTPUT', 'The provider response was too large.');
          parts.push(next.value);
        }
      } finally { void reader.cancel().catch(() => {}); }
    }
    return { status: response.status, headers: response.headers, body: parseJson(Buffer.concat(parts).toString()) };
  }

  const target = new URL(url);
  // DNS resolution is bounded by the same deadline. Connect to the validated address directly,
  // with the original hostname for HTTP Host, TLS SNI and certificate verification.
  const address = await new Promise<string>((resolve, reject) => {
    const cancelled = () => reject(signal.reason);
    signal.addEventListener('abort', cancelled, { once: true });
    lookup(target.hostname, { all: true, family: 4 }).then((entries) => {
      if (!entries.length || entries.some((entry) => !publicAddress(entry.address))) throw new AppError(503, 'AI_ENDPOINT', 'Approved AI endpoint could not be reached.');
      resolve(entries[0].address);
    }).catch(reject).finally(() => signal.removeEventListener('abort', cancelled));
  });
  return new Promise<Reply>((resolve, reject) => {
    const req = httpsRequest({
      hostname: address, servername: target.hostname, port: 443, path: target.pathname, signal, agent: false,
      method: payload === undefined ? 'GET' : 'POST',
      headers: { ...headers, Host: target.hostname, ...(payload === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(payload)) }) },
    }, (response) => {
      const parts: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maximumBytes) req.destroy(new AppError(502, 'AI_OUTPUT', 'The provider response was too large.'));
        else parts.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) if (typeof value === 'string') headers.set(name, value);
        resolve({ status: response.statusCode ?? 502, headers, body: parseJson(Buffer.concat(parts).toString()) });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function parseJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function auth(name: ProviderName, secret: string): Record<string, string> {
  if (name === 'GEMINI') return { 'x-goog-api-key': secret };
  if (name === 'ANTHROPIC') return { 'x-api-key': secret, 'anthropic-version': '2023-06-01' };
  return { Authorization: `Bearer ${secret}` };
}

export function buildRequest(options: ProviderOptions, secret: string, system: string, payload: string, output: number, schema?: Record<string, unknown>) {
  const name = providerName(options);
  const base = providerBase(options);
  const model = options.model ?? '';
  const headers = { ...auth(name, secret), 'Content-Type': 'application/json' };
  const user = { role: 'user', content: payload };
  const instructions = `${system}\nReturn a single JSON object without code fences.`;
  if (name === 'GEMINI') {
    const id = model.replace(/^models\//, '');
    return { url: `${base}/models/${encodeURIComponent(id)}:generateContent`, headers,
      body: { systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: 'user', parts: [{ text: payload }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: output } } };
  }
  if (name === 'ANTHROPIC') return { url: `${base}/messages`, headers, body: {
    model, system: instructions, messages: [user], max_tokens: output,
    ...(schema && options.outputMode !== 'PROMPT_JSON' ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
  } };
  const maxTokens = name === 'GROQ' || name === 'OPENAI' ? 'max_completion_tokens' : 'max_tokens';
  return { url: `${base}/chat/completions`, headers, body: {
    model, [maxTokens]: output, messages: [{ role: 'system', content: instructions }, user],
    ...(name === 'CUSTOM' && options.outputMode === 'PROMPT_JSON' ? {} : { response_format: { type: 'json_object' } }),
    ...(name === 'OPENROUTER' ? { provider: { allow_fallbacks: false, require_parameters: true } } : {}),
  } };
}

const tokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const dollars = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function normalize(name: ProviderName, value: unknown) {
  const body = object(value);
  if (name === 'GEMINI') {
    const usage = object(body.usageMetadata);
    const candidate = object(list(body.candidates)[0]);
    const text = list(object(candidate.content).parts).map(object).filter((part) => part.thought !== true).map((part) => part.text ?? '').join('');
    const candidateTokens = tokens(usage.candidatesTokenCount);
    const thoughtTokens = tokens(usage.thoughtsTokenCount);
    return { text, incomplete: candidate.finishReason !== 'STOP', input: tokens(usage.promptTokenCount),
      output: candidateTokens === undefined ? undefined : candidateTokens + (thoughtTokens ?? 0), total: tokens(usage.totalTokenCount), costUsd: undefined };
  }
  const usage = object(body.usage);
  if (name === 'ANTHROPIC') {
    const baseInput = tokens(usage.input_tokens);
    const input = baseInput === undefined ? undefined : baseInput + (tokens(usage.cache_creation_input_tokens) ?? 0) + (tokens(usage.cache_read_input_tokens) ?? 0);
    const output = tokens(usage.output_tokens);
    const text = list(body.content).map(object).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
    return { text, incomplete: !['end_turn', 'stop_sequence'].includes(String(body.stop_reason)), input, output,
      total: input === undefined || output === undefined ? undefined : input + output, costUsd: undefined };
  }
  const choice = object(list(body.choices)[0]);
  const message = object(choice.message);
  const text = typeof message.content === 'string' ? message.content :
    list(message.content).map(object).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
  return { text, incomplete: !['stop', 'end_turn'].includes(String(choice.finish_reason)),
    input: tokens(usage.prompt_tokens), output: tokens(usage.completion_tokens), total: tokens(usage.total_tokens),
    costUsd: name === 'OPENROUTER' ? dollars(usage.cost) : undefined };
}

export class ProviderFailure extends AppError {
  constructor(status: number, code: string, message: string, public readonly retryable = false) { super(status, code, message); }
}
export function providerFailure(status: number, body: unknown) {
  const error = object(object(body).error);
  const codes = [error.code, error.type, error.status].map(String);
  if (status === 429) return new ProviderFailure(429, 'AI_PROVIDER_LIMIT', 'The provider has limited requests. Try again after its allowance resets.', true);
  if ([401, 402, 403].includes(status)) return new ProviderFailure(503, 'AI_PROVIDER_ACCESS', 'The provider credential, permissions or billing need administrator attention.');
  if (status === 404 || codes.some((code) => ['model_not_found', 'model_decommissioned', 'model_unavailable'].includes(code))) {
    return new ProviderFailure(503, 'AI_MODEL_UNAVAILABLE', 'The configured AI model is unavailable.', true);
  }
  if (status === 529 || (status === 503 && codes.some((code) => ['UNAVAILABLE', 'overloaded_error', 'server_overloaded', 'service_unavailable', 'capacity_exceeded'].includes(code)))) {
    return new ProviderFailure(503, 'AI_PROVIDER_OVERLOADED', 'The provider declined the request due to capacity.', true);
  }
  if ([400, 413, 422].includes(status)) return new ProviderFailure(502, 'AI_PROVIDER_INPUT', 'The provider rejected the model or input options.');
  // Ambiguous upstream failures may have executed the operation. They never trigger a second attempt.
  return new ProviderFailure(503, 'AI_PROVIDER_UNCERTAIN', 'The provider did not confirm whether it completed the request.');
}

export function quotaHeaders(headers: Headers) {
  const quota: Record<string, string> = {};
  for (const [name, value] of headers) {
    if (name === 'retry-after') {
      if (/^\d+(?:\.\d+)?$/.test(value) || Number.isFinite(Date.parse(value))) quota[name] = value.slice(0, 100);
    } else if (/^(?:(?:x-)?ratelimit-|anthropic-ratelimit-)(?:limit|remaining|reset|requests|tokens|input-tokens|output-tokens)(?:-[a-z-]+)?$/.test(name)
      && /^[\dT Z:.,+hdms-]{1,100}$/i.test(value)) quota[name] = value;
  }
  return quota;
}
export function retryDelay(quota: Record<string, string>) {
  const retry = quota['retry-after'];
  const duration = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
  if (duration > 0) return duration;
  const resets = Object.entries(quota).filter(([key]) => key.includes('reset')).map(([, value]) => {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value) - Date.now();
    const units: Record<string, number> = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 };
    return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|[dhms])/g)].reduce((sum, part) => sum + Number(part[1]) * units[part[2]], 0);
  });
  return Math.max(60_000, ...resets.filter(Number.isFinite));
}

export async function invokeProvider(options: ProviderOptions, secret: string, system: string, payload: string, output: number, schema?: Record<string, unknown>) {
  const request = buildRequest(options, secret, system, payload, output, schema);
  return send(request.url, request.headers, options.timeoutMs ?? 12_000, providerName(options) === 'CUSTOM', request.body);
}

export async function discoverModels(options: ProviderOptions, secret: string) {
  const name = providerName(options);
  const reply = await send(`${providerBase(options)}/models`, auth(name, secret), options.timeoutMs ?? 12_000, name === 'CUSTOM');
  if (reply.status < 200 || reply.status >= 300) throw providerFailure(reply.status, reply.body);
  const body = object(reply.body);
  const items = list(body.data ?? body.models).map(object);
  return items.flatMap((item) => {
    if (name === 'GEMINI' && !list(item.supportedGenerationMethods).includes('generateContent')) return [];
    const id = name === 'GEMINI' ? String(item.name ?? '').replace(/^models\//, '') : item.id;
    if (typeof id !== 'string' || !/^[\w./:-]{1,160}$/.test(id)) return [];
    return [{ id, inputLimit: tokens(item.inputTokenLimit ?? item.context_length), outputLimit: tokens(item.outputTokenLimit) }];
  }).slice(0, 250);
}
