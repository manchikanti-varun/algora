/**
 * Display metadata for the provider adapters implemented in
 * algora-backend/src/modules/ai/providers.ts. Keep this list in sync with `providerNames`.
 * Model identifiers are intentionally not hard-coded: use Discover models or enter the
 * identifier published by the provider.
 */
export interface ProviderMeta {
  name: string;
  /** Official key console. Only fixed providers have a stable dashboard. */
  keyUrl?: string;
  modelPlaceholder: string;
  note: string;
}

export const providerMeta: Record<string, ProviderMeta> = {
  GROQ: {
    name: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    modelPlaceholder: 'Enter the Groq model ID',
    note: 'OpenAI-compatible chat completions with native JSON object mode.',
  },
  GEMINI: {
    name: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    modelPlaceholder: 'Enter the Gemini model ID',
    note: 'Uses the Gemini generateContent API and Google AI Studio keys.',
  },
  OPENROUTER: {
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    modelPlaceholder: 'Enter the OpenRouter model ID',
    note: 'Free-plan configurations must use a model identifier ending in :free.',
  },
  OPENAI: {
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    modelPlaceholder: 'Enter the OpenAI model ID',
    note: 'OpenAI chat completions with native JSON object mode.',
  },
  ANTHROPIC: {
    name: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    modelPlaceholder: 'Enter the Anthropic model ID',
    note: 'Messages API. Native JSON schema is used when Output capability allows it.',
  },
  DEEPSEEK: {
    name: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    modelPlaceholder: 'Enter the DeepSeek model ID',
    note: 'OpenAI-compatible chat completions.',
  },
  MISTRAL: {
    name: 'Mistral AI',
    keyUrl: 'https://console.mistral.ai/api-keys',
    modelPlaceholder: 'Enter the Mistral model ID',
    note: 'OpenAI-compatible chat completions.',
  },
  CUSTOM: {
    name: 'Approved OpenAI-compatible endpoint',
    modelPlaceholder: 'Provider model identifier',
    note: 'Only the approved Together AI and Fireworks endpoints are allowed.',
  },
};

export const providerLabel = (id: string) => providerMeta[id]?.name ?? id;

/**
 * A conservative default, scoped to the workload. Configurations in the same workload that may
 * share an underlying provider quota share a group, so the backend applies the strictest cap
 * across them. Student and Staff are separate by default because they normally use separate
 * credentials and budgets. To share a provider account across both workloads, set the same
 * group label in Advanced settings after verifying the accounts truly share a quota.
 */
export function defaultQuotaGroup(workload: string, provider: string, endpoint?: string) {
  const scope = workload === 'STUDENT_MENTOR' ? 'student' : 'staff';
  const family = provider === 'CUSTOM'
    ? (endpoint?.includes('together') ? 'custom-together' : 'custom-fireworks')
    : provider.toLowerCase();
  return `${scope}-${family}`;
}
