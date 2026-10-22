import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, renameSync } from 'node:fs';
import path from 'node:path';

const encode = b => b.toString('base64');
const decode = s => Buffer.from(s, 'base64');
export function seal(key, plaintext, aad) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { format: 1, nonce: encode(nonce), tag: encode(cipher.getAuthTag()), body: encode(body) };
}
export function unseal(key, envelope, aad) {
  if (envelope.format !== 1) throw new Error('Unsupported encrypted format');
  const cipher = createDecipheriv('aes-256-gcm', key, decode(envelope.nonce), { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(decode(envelope.tag));
  return Buffer.concat([cipher.update(decode(envelope.body)), cipher.final()]);
}
export class Vault {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    const keyPath = path.join(directory, 'master.key');
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    chmodSync(keyPath, 0o600); this.master = readFileSync(keyPath);
    if (this.master.length !== 32) throw new Error('Invalid local master key');
  }
  /** Random filename; caller-supplied IDs never become filesystem paths. */
  encrypt(payload, aad) {
    const key = randomBytes(32), token = randomBytes(32);
    const bytes = Buffer.from(JSON.stringify(seal(key, Buffer.from(JSON.stringify(payload)), aad)));
    const wrappedKey = JSON.stringify(seal(this.master, key, `key:${aad}`));
    const filename = `${token.toString('hex')}.enc`;
    writeFileSync(path.join(this.directory, filename), bytes, { mode: 0o600, flag: 'wx' });
    key.fill(0);
    return { filename, bytes, wrappedKey, token };
  }
  read(row, aad) {
    if (!/^[a-f0-9]{64}\.enc$/.test(row.filename)) throw new Error('Invalid vault path');
    const bytes = readFileSync(path.join(this.directory, row.filename));
    const key = unseal(this.master, JSON.parse(row.wrapped_key), `key:${aad}`);
    try { return { bytes, payload: JSON.parse(unseal(key, JSON.parse(bytes), aad).toString('utf8')) }; }
    finally { key.fill(0); }
  }
  close() { this.master.fill(0); }
}
