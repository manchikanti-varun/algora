import { badRequest } from './errors';

/** Accepts https://leetcode.com/problems/<slug>[/anything][?query]. Returns the canonical slug and URL. */
export function parseLeetCodeUrl(input: string): { slug: string; url: string } {
  let u: URL;
  try { u = new URL(input.trim()); } catch { throw badRequest('Invalid URL'); }
  if (u.protocol !== 'https:' || !['leetcode.com', 'www.leetcode.com'].includes(u.hostname) || u.username || u.password || u.port) {
    throw badRequest('URL must be an https://leetcode.com/problems/<slug>/ link');
  }
  const m = u.pathname.match(/^\/problems\/([A-Za-z0-9-]{1,100})(\/|$)/);
  if (!m) throw badRequest('URL must point to a LeetCode problem');
  const slug = m[1].toLowerCase();
  return { slug, url: `https://leetcode.com/problems/${slug}/` };
}
