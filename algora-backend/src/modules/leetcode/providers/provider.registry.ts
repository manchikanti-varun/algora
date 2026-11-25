import { env } from '../../../config/env';
import { AlfaProvider } from './alfa.provider';
import { DirectProvider } from './direct.provider';
import { LeetCodeQueryProvider, realLeetCodeQueryClient } from './leetcode-query.provider';
import { MockProvider } from './mock.provider';
import type { Authorization, SubmissionProvider } from './provider.interface';
import { networkTransport, userAgent, type HttpTransport } from './transport';
import { ProviderError } from '../leetcode.types';

export const KNOWN_PROVIDERS = ['direct', 'alfa', 'leetcode-query', 'mock'] as const;

/** Is the provider switched on in the environment? (Admin settings can only switch it OFF, never on.) */
export function envEnabled(id: string): boolean {
  if (!env.LEETCODE_SYNC_ENABLED) return false;
  return ({ direct: env.LEETCODE_DIRECT_ENABLED, alfa: env.LEETCODE_ALFA_ENABLED, 'leetcode-query': env.LEETCODE_QUERY_ENABLED, mock: env.LEETCODE_MOCK_ENABLED && !env.isProd } as Record<string, boolean>)[id] ?? false;
}

/** Authorisation of the DATA SOURCE. Every real provider here reaches LeetCode, so all need LeetCode's written permission. */
export function authorizationFor(id: string): Authorization {
  if (id === 'mock') return env.isProd ? { authorized: false, reason: 'Mock provider is never authorised in production' } : { authorized: true };
  if (!env.LEETCODE_PERMISSION_REF) return { authorized: false, reason: 'No LeetCode permission reference (LEETCODE_PERMISSION_REF)' };
  if (id === 'alfa') {
    if (!env.LEETCODE_ALFA_BASE_URL) return { authorized: false, reason: 'LEETCODE_ALFA_BASE_URL not configured' };
    if (!env.LEETCODE_ALFA_PERMISSION_REF) return { authorized: false, reason: 'No permission reference for the Alfa deployment (LEETCODE_ALFA_PERMISSION_REF)' };
  }
  return { authorized: true };
}

/** Refuses every request. Used for unauthorised providers so a coding mistake cannot reach the network. */
const deniedTransport = (id: string): HttpTransport => ({ kind: 'network', send: async () => { throw new ProviderError('CONFIG_ERROR', `${id} is not authorised`); } });

function build(): SubmissionProvider[] {
  const ua = userAgent(env.LEETCODE_CONTACT);
  const t = (id: string) => (authorizationFor(id).authorized && envEnabled(id) ? networkTransport() : deniedTransport(id));
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
