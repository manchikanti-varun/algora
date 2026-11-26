import { env, leetcodeConfigIssues } from '../../../config/env';
import { AlfaProvider } from './alfa.provider';
import { DirectProvider } from './direct.provider';
import { LeetCodeQueryProvider, realLeetCodeQueryClient } from './leetcode-query.provider';
import { MockProvider } from './mock.provider';
import type { Authorization, SubmissionProvider } from './provider.interface';
import { networkTransport, userAgent, type HttpTransport } from './transport';
import { ProviderError } from '../leetcode.types';

export const KNOWN_PROVIDERS = ['direct', 'alfa', 'leetcode-query', 'mock'] as const;

/** The priority list is the only per-provider switch: listed means requested, absent means disabled. */
export function providerRequested(id: string) {
  return (env.LEETCODE_PROVIDER_PRIORITY as string[]).includes(id);
}

let runtimeBlock: string | null = null;
export function blockIntegration(reason: string) { runtimeBlock = reason; }

export function providerConfigurationReason(id: string): string | null {
  if (!providerRequested(id)) return `${id} is not in LEETCODE_PROVIDER_PRIORITY`;
  const groups = ['DIRECT', 'ALFA', 'QUERY', 'MOCK'];
  const group = { direct: 'DIRECT', alfa: 'ALFA', 'leetcode-query': 'QUERY', mock: 'MOCK' }[id];
  const invalid = Object.entries(leetcodeConfigIssues).filter(([key]) =>
    !['LEETCODE_HEALTHCHECK_USERNAME', 'LEETCODE_SCHEDULER_ENABLED', 'LEETCODE_ACCESS_BASIS'].includes(key) &&
    (!groups.some((name) => key.startsWith(`LEETCODE_${name}_`)) || key.startsWith(`LEETCODE_${group}_`)));
  if (invalid.length) return invalid.map(([key, reason]) => `${key}: ${reason}`).join('; ');
  if (id === 'mock' && env.isProd) return 'Mock provider is disabled in production';
  if (id === 'alfa' && !env.LEETCODE_ALFA_BASE_URL) return 'LEETCODE_ALFA_BASE_URL is required for Alfa';
  return runtimeBlock;
}

export function envEnabled(id: string): boolean {
  return env.LEETCODE_SYNC_ENABLED && providerRequested(id) && !providerConfigurationReason(id);
}

const BASIS_STATEMENTS: Record<string, string> = {
  TERMS: 'Access is covered by LeetCode terms as the owner has read them.',
  WRITTEN_PERMISSION: 'LeetCode gave written permission for this access.',
  LICENSED_THIRD_PARTY: 'Access runs through a licensed third-party data provider.',
  INSTITUTIONAL: 'An institutional agreement covers this access.',
  COMMERCIAL: 'A commercial agreement covers this access.',
  STUDENT_CONSENT: 'Each synchronized student consented in Algora to Algora reading their own public LeetCode profile. No LeetCode permission is claimed.',
};

/** The single activation safeguard: a recorded access basis other than NONE. */
function externalAccess(): Authorization {
  const basis = env.LEETCODE_ACCESS_BASIS;
  if (leetcodeConfigIssues.LEETCODE_ACCESS_BASIS) return { authorized: false, reason: `LEETCODE_ACCESS_BASIS: ${leetcodeConfigIssues.LEETCODE_ACCESS_BASIS}`, basis: 'NONE' };
  if (basis === 'NONE') return { authorized: false, reason: 'Awaiting activation: LEETCODE_ACCESS_BASIS is NONE (no access basis recorded)', basis };
  return { authorized: true, basis };
}
export function accessSummary() {
  const access = externalAccess();
  return { basis: access.basis ?? 'NONE', activated: access.authorized, reason: access.reason ?? null, statement: access.authorized ? BASIS_STATEMENTS[access.basis ?? 'NONE'] ?? null : null };
}
export function authorizationFor(id: string): Authorization {
  if (id === 'mock') return env.isProd ? { authorized: false, reason: 'Mock provider is disabled in production' } : { authorized: true };
  return externalAccess();
}
/** Refuses every request. Used for unauthorised providers so a coding mistake cannot reach the network. */
const deniedTransport = (id: string): HttpTransport => ({ kind: 'network', send: async () => { throw new ProviderError('CONFIG_ERROR', `${id} is not authorised`); } });

function build(): SubmissionProvider[] {
  const ua = userAgent(env.LEETCODE_CONTACT);
  const network = networkTransport();
  const t = (id: string): HttpTransport => ({
    kind: 'network',
    send: (request) => (authorizationFor(id).authorized && envEnabled(id) ? network : deniedTransport(id)).send(request),
  });
  const list: SubmissionProvider[] = [
    new DirectProvider(t('direct'), () => authorizationFor('direct'), ua),
    new AlfaProvider(t('alfa'), env.LEETCODE_ALFA_BASE_URL ?? '', () => authorizationFor('alfa'), ua, env.LEETCODE_ALFA_CACHE_SEC),
    new LeetCodeQueryProvider(
      async () => { if (!(authorizationFor('leetcode-query').authorized && envEnabled('leetcode-query'))) throw new Error('not authorised'); return realLeetCodeQueryClient(); },
      () => authorizationFor('leetcode-query'), 'network', env.LEETCODE_QUERY_MODE),
  ];
  if (!env.isProd) list.push(new MockProvider('mock'));
  return list;
}

let instances: SubmissionProvider[] | null = null;
/** Test override: replaces the registry. Providers passed here are treated as env-enabled. */
let testProviders: SubmissionProvider[] | null = null;

export const isTestOverride = () => testProviders !== null;
export function registry(): SubmissionProvider[] {
  if (testProviders) return testProviders;
  if (!instances) instances = build();
  return instances;
}
export function setProvidersForTests(p: SubmissionProvider[] | SubmissionProvider | null | undefined) {
  if (env.isProd) throw new Error('test providers are not allowed in production');
  testProviders = p == null ? null : Array.isArray(p) ? p : [p];
}
/** Back-compat helper for older tests. */
export const setProviderForTests = setProvidersForTests;
export const providerEnvEnabled = (id: string) => (testProviders ? env.LEETCODE_SYNC_ENABLED && testProviders.some((p) => p.id === id) : envEnabled(id));
