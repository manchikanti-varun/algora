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

/**
 * Model-specific Groq behaviour, from https://console.groq.com/docs/reasoning and /docs/api-reference.
 * GPT-OSS 20B/120B always reason. Reasoning tokens are billed against max_completion_tokens, so a small
 * budget can be exhausted before any JSON is emitted (Groq then answers 400 json_validate_failed).
 * They accept reasoning_effort (low|medium|high) and include_reasoning, but reject reasoning_format.
 */
export const isGptOss = (model?: string | null) => /^openai\/gpt-oss-(?:20b|120b)$/.test(model ?? '');
const reasoningHeadroom = 512;
/** Completion-token budget to send (and reserve) for a request, including reasoning headroom where the model needs it. */
export function outputBudget(options: ProviderOptions, requested: number, cap?: number | null) {
  const wanted = providerName(options) === 'GROQ' && isGptOss(options.model) ? requested + reasoningHeadroom : requested;
  return cap ? Math.min(cap, wanted) : wanted;
}

export function buildRequest(options: ProviderOptions, secret: string, system: string, payload: string, output: number, schema?: Record<string, unknown>, test = false) {
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
    // Never send reasoning_format to GPT-OSS (unsupported). include_reasoning is mutually exclusive with it.
    ...(name === 'GROQ' && isGptOss(model) ? { reasoning_effort: test ? 'low' : 'medium', include_reasoning: false } : {}),
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
  // Reasoning arrives in message.reasoning (never parsed as an answer). Inline <think> blocks are removed defensively.
  const raw = typeof message.content === 'string' ? message.content :
    list(message.content).map(object).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
  const text = raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : raw;
  return { text, finish: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined,
    incomplete: !['stop', 'end_turn'].includes(String(choice.finish_reason)),
    input: tokens(usage.prompt_tokens), output: tokens(usage.completion_tokens), total: tokens(usage.total_tokens),
    costUsd: name === 'OPENROUTER' ? dollars(usage.cost) : undefined };
}

export interface ProviderDiagnostics {
  provider: string; model?: string; httpStatus?: number; providerCode?: string; rejectedParameter?: string;
  requestId?: string; finishReason?: string; message?: string; suggestion: string;
}
export class ProviderFailure extends AppError {
  constructor(status: number, code: string, message: string, public readonly retryable = false, public readonly diagnostics?: ProviderDiagnostics) { super(status, code, message); }
}
const secretPattern = /(?:gsk_|sk-|sk_|AIza|xai-|Bearer\s+)[\w.-]{6,}/g;
const clean = (value: unknown, max: number) => typeof value === 'string' || typeof value === 'number'
  ? String(value).replace(secretPattern, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, max) || undefined : undefined;
const identifier = (value: unknown) => { const text = clean(value, 100); return text && /^[\w.:/-]+$/.test(text) && !text.includes('[redacted]') ? text : undefined; };
const suggestion = (status: number, code: string | undefined, param: string | undefined, name: string, model: string | undefined) => {
  if (code === 'json_validate_failed') return 'The model did not finish a valid JSON object, usually because reasoning used the whole output budget. Increase the configuration output limit or retry.';
  if (code === 'model_not_found' || code === 'model_decommissioned' || status === 404) return `Choose a model your ${name} account can use; refresh the model list.`;
  if (status === 401 || status === 403) return `Replace the ${name} API key and confirm it has access to ${model ?? 'the model'}.`;
  if (status === 402) return `Check ${name} billing or credits.`;
  if (status === 413) return 'Reduce the input size or choose a model with a larger context window.';
  if (status === 429) return 'Wait for the provider allowance to reset or raise the provider plan.';
  if (param) return `The provider rejected parameter "${param}" for model ${model ?? ''}. Report this so the adapter can omit it for this model.`;
  if (status >= 400 && status < 500) return 'Check the model ID, output limit and output capability. Compare with the provider documentation for this model.';
  return 'Retry later. If it persists, check the provider status page.';
};
export function providerFailure(status: number, body: unknown, context?: { provider?: string; model?: string | null; headers?: Headers }) {
  const error = object(object(body).error);
  const codes = [error.code, error.type, error.status].map(String);
  const providerCode = identifier(error.code) ?? identifier(error.type) ?? identifier(error.status);
  const message = clean(error.message, 300);
  const param = identifier(error.param) ?? (message?.match(/(?:parameter|property|field)\s+[`'"]?([\w.]+)[`'"]?/i)?.[1]
    ?? message?.match(/[`'"](reasoning_\w+|include_reasoning|response_format|max_\w+|temperature|top_p|stop|seed)[`'"]/)?.[1]);
  const provider = context?.provider ?? 'UNKNOWN';
  const model = clean(context?.model, 160);
  const requestId = identifier(context?.headers?.get('x-request-id') ?? context?.headers?.get('request-id') ?? context?.headers?.get('cf-ray'));
  const diagnostics: ProviderDiagnostics = { provider, model, httpStatus: status, providerCode, rejectedParameter: param, requestId, message,
    suggestion: suggestion(status, providerCode, param, provider, model) };
  const fail = (http: number, code: string, text: string, retryable = false) => new ProviderFailure(http, code, text, retryable, diagnostics);
  if (status === 429) return fail(429, 'AI_PROVIDER_LIMIT', 'The provider has limited requests. Try again after its allowance resets.', true);
  if ([401, 402, 403].includes(status)) return fail(503, 'AI_PROVIDER_ACCESS', 'The provider credential, permissions or billing need administrator attention.');
  if (status === 404 || codes.some((code) => ['model_not_found', 'model_decommissioned', 'model_unavailable'].includes(code))) {
    return fail(503, 'AI_MODEL_UNAVAILABLE', 'The configured AI model is unavailable.', true);
  }
  if (status === 529 || (status === 503 && codes.some((code) => ['UNAVAILABLE', 'overloaded_error', 'server_overloaded', 'service_unavailable', 'capacity_exceeded'].includes(code)))) {
    return fail(503, 'AI_PROVIDER_OVERLOADED', 'The provider declined the request due to capacity.', true);
  }
  if ([400, 413, 422].includes(status)) return fail(502, 'AI_PROVIDER_INPUT', 'The provider rejected the model or input options.');
  // Ambiguous upstream failures may have executed the operation. They never trigger a second attempt.
  return fail(503, 'AI_PROVIDER_UNCERTAIN', 'The provider did not confirm whether it completed the request.');
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

export async function invokeProvider(options: ProviderOptions, secret: string, system: string, payload: string, output: number, schema?: Record<string, unknown>, test = false) {
  const request = buildRequest(options, secret, system, payload, output, schema, test);
  return send(request.url, request.headers, options.timeoutMs ?? 12_000, providerName(options) === 'CUSTOM', request.body);
}

export async function discoverModels(options: ProviderOptions, secret: string) {
  const name = providerName(options);
  const reply = await send(`${providerBase(options)}/models`, auth(name, secret), options.timeoutMs ?? 12_000, name === 'CUSTOM');
  if (reply.status < 200 || reply.status >= 300) throw providerFailure(reply.status, reply.body, { provider: name, headers: reply.headers });
  const body = object(reply.body);
  const items = list(body.data ?? body.models).map(object);
  return items.flatMap((item) => {
    if (name === 'GEMINI' && !list(item.supportedGenerationMethods).includes('generateContent')) return [];
    const id = name === 'GEMINI' ? String(item.name ?? '').replace(/^models\//, '') : item.id;
    if (typeof id !== 'string' || !/^[\w./:-]{1,160}$/.test(id)) return [];
    return [{ id, inputLimit: tokens(item.inputTokenLimit ?? item.context_length), outputLimit: tokens(item.outputTokenLimit) }];
  }).slice(0, 250);
}
