import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateTransaction } from './lib.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtime = JSON.parse(await readFile(new URL('runtime.json', import.meta.url), 'utf8'));
const rpcUrl = new URL(runtime.rpcUrl);
if (!['127.0.0.1', 'localhost'].includes(rpcUrl.hostname)) throw new Error('Only a local Anvil RPC is supported');
const port = Number(process.env.PORT || 4173);
const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
let requestId = 0;
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Local RPC HTTP ${response.status}`);
  const result = await response.json();
  return result;
}
const chain = await rpc('eth_chainId');
if (chain.result !== '0x7a69') throw new Error('Expected Anvil chain ID 31337');
const accountsResponse = await rpc('eth_accounts');
const signatures = [
  'fund()', 'withdraw()', 'owner()', 'MINIMUM_USD()', 'totalRaised()', 'totalWithdrawn()',
  'contributions(address)', 'getUsdValue(uint256)', 'maxPriceAge()',
  'Funded(address,uint256,uint256)', 'Withdrawn(address,uint256)',
  'BelowMinimum(uint256,uint256)', 'Unauthorized()', 'StalePrice()', 'InvalidPrice()',
  'EmptyBalance()', 'TransferFailed()', 'Reentrancy()',
];
const selectors = {};
for (const signature of signatures) {
  const result = await rpc('web3_sha3', ['0x' + Buffer.from(signature).toString('hex')]);
  if (!result.result) throw new Error(`Cannot compute selector: ${signature}`);
  selectors[signature] = signature.startsWith('Funded(') || signature.startsWith('Withdrawn(')
    ? result.result : result.result.slice(0, 10);
}
const config = { ...runtime, accounts: accountsResponse.result, selectors, chainId: '0x7a69' };
if (!Array.isArray(config.accounts) || config.accounts.length < 2) throw new Error('Anvil accounts unavailable');
const readMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_call', 'eth_getLogs']);
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/lib.mjs', ['lib.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const host = request.headers.host;
  if (!origins.has(`http://${host}`)) return json(response, 403, { error: 'Invalid host' });
  if (request.headers.origin && !origins.has(request.headers.origin)) return json(response, 403, { error: 'Invalid origin' });
  if (request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Cross-site requests are disabled' });
  const path = new URL(request.url, `http://${host}`).pathname;
  try {
    if (request.method === 'GET' && path === '/api/config') return json(response, 200, config);
    if (request.method === 'POST' && path === '/api/rpc') {
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'JSON required' });
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 16384) return json(response, 413, { error: 'Request too large' });
      }
      const payload = JSON.parse(body);
      if (!Array.isArray(payload.params)) throw new Error('RPC params must be an array');
      if (payload.method === 'eth_sendTransaction') {
        if (payload.params.length !== 1) throw new Error('One transaction required');
        validateTransaction(payload.params[0], config);
        const currentChain = await rpc('eth_chainId');
        if (currentChain.result !== config.chainId) throw new Error('Local network changed');
      } else {
        if (!readMethods.has(payload.method)) throw new Error('RPC method not allowed');
        if (payload.method === 'eth_call' && String(payload.params[0]?.to).toLowerCase() !== config.address.toLowerCase()) throw new Error('Unexpected call target');
        if (payload.method === 'eth_getLogs' && String(payload.params[0]?.address).toLowerCase() !== config.address.toLowerCase()) throw new Error('Unexpected log address');
      }
      return json(response, 200, await rpc(payload.method, payload.params));
    }
    const file = staticFiles.get(path);
    if (request.method === 'GET' && file) {
      const body = await readFile(root + file[0]);
      response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
      return response.end(body);
    }
    return json(response, 404, { error: 'Not found' });
  } catch (error) {
    return json(response, error.name === 'SyntaxError' ? 400 : 502, { error: error.message });
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`FundMe local app: http://127.0.0.1:${port}`);
  console.log(`Contract: ${config.address} | Anvil chain 31337`);
});
