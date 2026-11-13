// Copy the locked QR decoder dependency for same-origin, offline-capable camera decoding.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';
const require = createRequire(import.meta.url),
  reader = dirname(require.resolve('zxing-wasm/reader'));
await mkdir('public/scanner', { recursive: true });
await copyFile(
  resolve(reader, '../../reader/zxing_reader.wasm'),
  'public/scanner/zxing_reader.wasm',
);
await copyFile(
  resolve(reader, '../../../LICENSE'),
  'public/scanner/ZXING-LICENSE.txt',
);
