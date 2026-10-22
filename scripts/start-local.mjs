import { createApp } from '../server/app.mjs';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535');
const origin = `http://127.0.0.1:${port}`;
const service = await createApp({ origin });
const server = service.app.listen(port, '127.0.0.1', () => {
  console.log(`CORG medical-record prototype: ${origin}`);
  console.log('Synthetic local demo only. Demo wallets and local key custody are not production identity/security.');
});
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.close(async () => { await service.close(); process.exit(0); }); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
