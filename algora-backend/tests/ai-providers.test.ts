import { describe, expect, it } from 'vitest';
import { buildRequest, isGptOss, outputBudget, customEndpoints, discoverModels, normalize, providerBase, providerFailure, providerNames, publicAddress, quotaHeaders, retryDelay } from '../src/modules/ai/providers';

const choice = { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };

describe('AI provider contracts', () => {
  const cases = [
    ['GROQ', 'https://api.groq.com/openai/v1/chat/completions', 'max_completion_tokens'],
    ['OPENAI', 'https://api.openai.com/v1/chat/completions', 'max_completion_tokens'],
    ['OPENROUTER', 'https://openrouter.ai/api/v1/chat/completions', 'max_tokens'],
    ['DEEPSEEK', 'https://api.deepseek.com/chat/completions', 'max_tokens'],
    ['MISTRAL', 'https://api.mistral.ai/v1/chat/completions', 'max_tokens'],
    ['CUSTOM', `${customEndpoints[0]}/chat/completions`, 'max_tokens'],
  ] as const;
  it.each(cases)('%s request and completion usage', (provider, url, field) => {
    const request = buildRequest({ provider, model: 'fixture', endpoint: provider === 'CUSTOM' ? customEndpoints[0] : undefined },
      'example-key', 'System policy', '{"user":"data"}', 300);
    expect(request.url).toBe(url);
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer example-key');
    expect(request.body).toMatchObject({ [field]: 300, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: expect.stringContaining('System policy') }, { role: 'user', content: '{"user":"data"}' },
    ] });
    if (provider === 'OPENROUTER') expect(request.body).toMatchObject({ provider: { allow_fallbacks: false, require_parameters: true } });
    expect(normalize(provider, choice)).toMatchObject({ text: '{"ok":true}', incomplete: false, input: 10, output: 5, total: 15 });
    expect(normalize(provider, {}).total).toBeUndefined();
  });

  it('uses Gemini native instructions, API-key header and JSON mode', () => {
    expect(buildRequest({ provider: 'GEMINI', model: 'models/gemini-fixture' }, 'example-key', 'System policy', '{}', 300)).toMatchObject({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent',
      headers: { 'x-goog-api-key': 'example-key' },
      body: { systemInstruction: { parts: [{ text: expect.stringContaining('System policy') }] },
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 300 } },
    });
    expect(normalize('GEMINI', { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private' }, { text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 20 } }))
      .toMatchObject({ text: '{"ok":true}', incomplete: false, input: 10, output: 5, total: 20 });
  });

  it('uses Anthropic model, Messages headers, prompts and cached input usage', () => {
    expect(buildRequest({ provider: 'ANTHROPIC', model: 'claude-fixture' }, 'example-key', 'System policy', '{}', 300)).toMatchObject({
      url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': 'example-key', 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-fixture', max_tokens: 300, system: expect.stringContaining('System policy') },
    });
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    expect(buildRequest({ provider: 'ANTHROPIC', model: 'fixture' }, 'example-key', '', '{}', 128, schema).body)
      .toMatchObject({ output_config: { format: { type: 'json_schema', schema } } });
    const body = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 2, output_tokens: 5 } };
    expect(normalize('ANTHROPIC', body)).toMatchObject({ text: '{"ok":true}', incomplete: false, input: 15, output: 5, total: 20 });
    expect(normalize('ANTHROPIC', { ...body, stop_reason: 'max_tokens' }).incomplete).toBe(true);
  });

  it('preserves only trustworthy quota headers and distinguishes rejection from ambiguous completion', () => {
    expect(providerFailure(429, {}).retryable).toBe(true);
    expect(providerFailure(503, { error: { status: 'UNAVAILABLE' } }).retryable).toBe(true);
    expect(providerFailure(529, {}).retryable).toBe(true);
    for (const status of [400, 401, 402, 403, 422, 500, 502, 503, 504]) expect(providerFailure(status, {}).retryable).toBe(false);
    const headers = quotaHeaders(new Headers({ 'Retry-After': '6', 'anthropic-ratelimit-requests-reset': '2026-01-01T02:00:00Z', 'X-Private': 'discard' }));
    expect(headers).toEqual({ 'retry-after': '6', 'anthropic-ratelimit-requests-reset': '2026-01-01T02:00:00Z' });
    expect(retryDelay(headers)).toBe(6000);
    expect(normalize('OPENROUTER', { ...choice, usage: { ...choice.usage, cost: 0.0001 } }).costUsd).toBe(0.0001);
  });

  it('allows only approved custom bases and rejects non-public address classes without sending a request', () => {
    expect(providerNames).toHaveLength(8);
    expect(providerBase({ provider: 'CUSTOM', endpoint: customEndpoints[1] + '/' })).toBe(customEndpoints[1]);
    for (const endpoint of ['http://api.together.ai/v1', 'https://localhost/v1', 'https://api.together.ai:80/v1',
      customEndpoints[0] + '?x=1', 'https://api.together.ai@loopback.invalid/v1', 'https://api.together.ai.other.invalid/v1']) {
      expect(() => providerBase({ provider: 'CUSTOM', endpoint })).toThrow();
    }
    expect(() => providerBase({ provider: 'OPENAI', endpoint: customEndpoints[0] })).toThrow();
    for (const address of ['127.0.0.1', '10.0.0.3', '169.254.169.254', '192.168.0.1', '100.64.0.5', '0.0.0.0', '::1', '::ffff:127.0.0.1', '224.0.0.1']) {
      expect(publicAddress(address)).toBe(false);
    }
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(buildRequest({ provider: 'CUSTOM', endpoint: customEndpoints[0], model: 'fixture', outputMode: 'PROMPT_JSON' },
      'example-key', '', '{}', 128).body).not.toHaveProperty('response_format');
  });

  it('discovers bounded model metadata and keeps Gemini generation models only', async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string | URL | Request) => {
        if (String(url).includes('generativelanguage')) return Response.json({ models: [
          { name: 'models/gemini-fixture', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1000, outputTokenLimit: 100 },
          { name: 'models/embedding-fixture', supportedGenerationMethods: ['embedContent'] },
        ] });
        return Response.json({ data: [
          { id: 'fixture-model', context_length: 8192, outputTokenLimit: 512 },
          { id: 'invalid model id!' },
        ] });
      }) as typeof fetch;
      await expect(discoverModels({ provider: 'GROQ' }, 'example-key'))
        .resolves.toEqual([{ id: 'fixture-model', inputLimit: 8192, outputLimit: 512 }]);
      await expect(discoverModels({ provider: 'GEMINI' }, 'example-key'))
        .resolves.toEqual([{ id: 'gemini-fixture', inputLimit: 1000, outputLimit: 100 }]);
    } finally { globalThis.fetch = original; }
  });

  it.each(['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])('builds model-aware Groq parameters for %s', (model) => {
    const probe = buildRequest({ provider: 'GROQ', model }, 'example-key', 'Policy', '{}', 576, undefined, true).body as Record<string, unknown>;
    expect(probe).toEqual({ model, max_completion_tokens: 576, messages: expect.any(Array), response_format: { type: 'json_object' },
      reasoning_effort: 'low', include_reasoning: false });
    const generation = buildRequest({ provider: 'GROQ', model }, 'example-key', 'Policy', '{}', 2000).body as Record<string, unknown>;
    expect(generation).toMatchObject({ reasoning_effort: 'medium', include_reasoning: false, response_format: { type: 'json_object' } });
    expect(generation).not.toHaveProperty('reasoning_format');
    expect(outputBudget({ provider: 'GROQ', model }, 64)).toBe(576);
    expect(outputBudget({ provider: 'GROQ', model }, 64, 300)).toBe(300);
  });

  it('sends no reasoning parameters to other Groq models or providers', () => {
    for (const options of [{ provider: 'GROQ', model: 'llama-3.3-70b-versatile' }, { provider: 'OPENAI', model: 'openai/gpt-oss-120b' },
      { provider: 'OPENROUTER', model: 'openai/gpt-oss-120b:free' }, { provider: 'DEEPSEEK', model: 'openai/gpt-oss-20b' }]) {
      const body = buildRequest(options, 'example-key', 'Policy', '{}', 64, undefined, true).body;
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body).not.toHaveProperty('include_reasoning');
      expect(outputBudget(options, 64)).toBe(64);
    }
    expect(isGptOss('openai/gpt-oss-safeguard-20b')).toBe(false);
  });

  it('parses content separately from reasoning and strips inline think blocks', () => {
    const body = { choices: [{ finish_reason: 'stop', message: { reasoning: 'private', content: '{"ok":true}' } }], usage: { prompt_tokens: 74, completion_tokens: 35, total_tokens: 109 } };
    expect(normalize('GROQ', body)).toMatchObject({ text: '{"ok":true}', finish: 'stop', incomplete: false, total: 109 });
    expect(normalize('GROQ', { choices: [{ finish_reason: 'stop', message: { content: '<think>x</think>{"ok":true}' } }] }).text).toBe('{"ok":true}');
    expect(normalize('GROQ', { choices: [{ finish_reason: 'length', message: { content: '', reasoning: 'x' } }] })).toMatchObject({ text: '', incomplete: true, finish: 'length' });
  });

  it('extracts sanitized diagnostics without echoing generated content or secrets', () => {
    const failure = providerFailure(400, { error: { message: 'Failed to generate JSON with gsk_abcdef123456', code: 'json_validate_failed', type: 'invalid_request_error',
      failed_generation: 'private student code' } }, { provider: 'GROQ', model: 'openai/gpt-oss-120b', headers: new Headers({ 'x-request-id': 'req_9' }) });
    expect(failure.diagnostics).toMatchObject({ provider: 'GROQ', model: 'openai/gpt-oss-120b', httpStatus: 400, providerCode: 'json_validate_failed',
      requestId: 'req_9', suggestion: expect.stringContaining('output limit') });
    expect(JSON.stringify(failure.diagnostics)).not.toMatch(/gsk_abcdef|private student code/);
    expect(providerFailure(400, { error: { message: "unknown parameter 'top_p'" } }, { provider: 'GROQ' }).diagnostics?.rejectedParameter).toBe('top_p');
    expect(providerFailure(401, {}, { provider: 'GROQ', model: 'm' }).diagnostics?.suggestion).toContain('API key');
  });
});
