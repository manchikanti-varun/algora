export function keyFromRing(
  id: string | undefined,
  raw: string | undefined,
): Buffer | null {
  try {
    const keys: unknown = JSON.parse(raw ?? '{}');
    const value =
      id && keys && typeof keys === 'object' && !Array.isArray(keys)
        ? (keys as Record<string, unknown>)[id]
        : undefined;
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value))
      return null;
    const key = Buffer.from(value, 'base64');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}
export const qrKeyAvailable = (
  active: string | undefined,
  raw: string | undefined,
) =>
  !!active &&
  /^[a-zA-Z0-9_-]{1,40}$/.test(active) &&
  !!keyFromRing(active, raw);
