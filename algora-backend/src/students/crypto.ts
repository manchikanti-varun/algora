import { keyFromRing, qrKeyAvailable } from './keyring.js';
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import type { Credential } from './contracts.js';
export class QrVault {
  constructor(
    private active = process.env.QR_ACTIVE_KEY_ID,
    private raw = process.env.QR_ENCRYPTION_KEYS,
  ) {}
  private key(id: string) {
    const key = keyFromRing(id, this.raw);
    if (!key)
      throw new AppError(
        503,
        'QR_UNAVAILABLE',
        'QR credential encryption is unavailable',
      );
    return key;
  }
  available() {
    return qrKeyAvailable(this.active, this.raw);
  }
  issue(profileId: string, version: number) {
    if (!this.available())
      throw new AppError(
        503,
        'QR_UNAVAILABLE',
        'QR credential encryption is unavailable',
      );
    const token = randomBytes(32).toString('base64url');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(this.active!), nonce);
    cipher.setAAD(Buffer.from(`${profileId}:${version}:${this.active}`));
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return {
      profileId,
      version,
      tokenHash: QrVault.hash(token),
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyId: this.active!,
    } satisfies Credential;
  }
  reveal(c: Credential) {
    try {
      const cipher = createDecipheriv(
        'aes-256-gcm',
        this.key(c.keyId),
        Buffer.from(c.nonce, 'base64'),
      );
      cipher.setAAD(Buffer.from(`${c.profileId}:${c.version}:${c.keyId}`));
      cipher.setAuthTag(Buffer.from(c.tag, 'base64'));
      const token = Buffer.concat([
        cipher.update(Buffer.from(c.ciphertext, 'base64')),
        cipher.final(),
      ]).toString('utf8');
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(token) ||
        QrVault.hash(token) !== c.tokenHash
      )
        throw new Error();
      return token;
    } catch {
      throw new AppError(
        503,
        'QR_UNAVAILABLE',
        'QR credential encryption is unavailable',
      );
    }
  }
  static hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
