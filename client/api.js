import { Wallet } from 'ethers';
import { browserRequest } from './browser-engine.js';

let config, token, wallet, role = 'patient', browser = false;
async function http(method, path, body, session = token) {
  const response = await fetch(path, { method, headers: { ...(['POST','PUT','PATCH','DELETE'].includes(method) ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Not a local API');
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : result.message || 'The request could not be completed.');
  return result;
}
async function request(method, path, body, session = token) {
  return browser ? browserRequest(method, path, body ?? {}, session) : http(method, path, body, session);
}
export const api = {
  async init() {
    // Static hosting has no API. Only use the local server when it supplies the explicit demo configuration.
    try { config = await http('GET', '/api/config', undefined, null); if (config.mode !== 'local-evm') throw new Error('Unsupported API'); }
    catch (error) { if (['127.0.0.1','localhost'].includes(location.hostname)) throw error; browser = true; config = await browserRequest('GET', '/api/config'); }
    return config;
  },
  async login(nextRole) {
    if(token) { try { await request('POST','/api/auth/logout',{}); } catch {} }
    token = undefined; wallet = undefined; role = nextRole;
    const identity = config.identities.find(item => item.role === role);
    if (!identity) throw new Error('Demo identity is unavailable.');
    wallet = new Wallet(identity.privateKey);
    const challenge = await request('POST', '/api/auth/challenge', { address: identity.address }, null);
    const result = await request('POST', '/api/auth/verify', { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) }, null);
    token = result.token;
    return identity;
  },
  get config() { return config; },
  get role() { return role; },
  async listRecords() { return (await request('GET', '/api/records')).records; },
  async detail(id) { const d = await request('GET', `/api/records/${encodeURIComponent(id)}`); return d.record ? {...d.record, versions:d.versions} : d; },
  async getAudit(id) { return (await request('GET', `/api/audit${id ? `?recordId=${encodeURIComponent(id)}` : ''}`)).events; },
  async readRecord(id, version) { return request('GET', `/api/records/${encodeURIComponent(id)}/versions/${version}/content`); },
  async createRecord({ title, category, content }) { return request('POST', '/api/records', { title, category, type: category, content: typeof content === 'string' ? content : JSON.stringify(content) }); },
  async grant(id, { permissions, durationHours }) { return request('POST', `/api/records/${encodeURIComponent(id)}/grants`, { delegate: config.identities.find(x => x.role === 'clinician').address, permissions: Number(permissions), expiresAt: Math.floor(Date.now() / 1000 + Number(durationHours) * 3600) }); },
  async revoke(id) { return request('DELETE', `/api/records/${encodeURIComponent(id)}/grants/${config.identities.find(x => x.role === 'clinician').address}`); },
  async revokeAll() { return request('POST', '/api/revoke-all', {}); },
  async archive(id, archived) { return request('POST', `/api/records/${encodeURIComponent(id)}/archive`, { archived }); },
  async append(id, { content, expectedVersion }) {
    const prepared = await request('POST', `/api/records/${encodeURIComponent(id)}/prepare`, { content: typeof content === 'string' ? content : JSON.stringify(content), expectedVersion });
    const signature = await wallet.signTypedData(prepared.domain, prepared.types, prepared.value);
    return request('POST', `/api/records/${encodeURIComponent(id)}/versions`, { requestId: prepared.requestId, signature });
  },
};
