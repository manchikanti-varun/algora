import type { MetadataRoute } from 'next';
/** Private application: nothing should be indexed. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
