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

/**
 * Bases that represent an arrangement established outside Algora: terms, written permission, a licence, or a contract.
 * OWN_RISK is deliberately excluded: it is an internal risk decision, NOT permission from LeetCode.
 */
export const EXTERNAL_ACCESS_BASES = ['TERMS', 'WRITTEN_PERMISSION', 'LICENSED_THIRD_PARTY', 'INSTITUTIONAL', 'COMMERCIAL'] as const;

/** Human-readable access-basis summary for the admin UI. Never contains a secret. */
export function accessSummary() {
  const basis = env.LEETCODE_ACCESS_BASIS;
  return {
    basis,
    reference: env.LEETCODE_ACCESS_REF ?? null,
    /** True only when the basis is an arrangement established with/under LeetCode, not our own risk acceptance. */
    establishedExternally: (EXTERNAL_ACCESS_BASES as readonly string[]).includes(basis),
    internalRiskAcceptance: basis === 'OWN_RISK',
  };
}

/**
 * Authorisation of the DATA SOURCE, expressed as an access basis. A basis is required for every real provider; how it was
 * established (LeetCode permission, public API terms, a licence, an institution, a contract, or an internal risk decision)
 * is reported verbatim and never relabelled as permission from LeetCode.
 */
export function authorizationFor(id: string): Authorization {
  if (id === 'mock') return env.isProd ? { authorized: false, reason: 'Mock provider is never authorised in production', basis: 'NONE' } : { authorized: true, basis: 'OWN_RISK' };
  const basis = env.LEETCODE_ACCESS_BASIS;
  const reference = env.LEETCODE_ACCESS_REF ?? null;
  if (basis === 'NONE') return { authorized: false, reason: 'No LeetCode access basis configured (LEETCODE_ACCESS_BASIS)', basis };
  if (basis === 'OWN_RISK') return { authorized: false, reason: 'Internal risk acceptance does not grant provider access', basis };
  if (!reference) {
    return { authorized: false, reason: `LEETCODE_ACCESS_BASIS=${basis} has no LEETCODE_ACCESS_REF`, basis };
  }
  if (id === 'alfa') {
    if (!env.LEETCODE_ALFA_BASE_URL) return { authorized: false, reason: 'LEETCODE_ALFA_BASE_URL not configured', basis, reference };
    if (!env.LEETCODE_ALFA_PERMISSION_REF && !reference) return { authorized: false, reason: 'No access reference for the Alfa deployment (LEETCODE_ALFA_PERMISSION_REF)', basis, reference };
  }
  return { authorized: true, basis, reference };
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
