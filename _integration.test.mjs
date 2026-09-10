/**
 * AZNP ��Ƽü�� ���� �׽�Ʈ (mock KV + mock RPC)
 *
 * ���: src/worker.js ���� �Լ� (getPlan / handleTopup / handleBaseTopup /
 *       callBaseRpc / x402PaymentRequiredResponse) + �⺻ fetch �����(/health)
 *
 * ����: node _integration.test.mjs
 *  - Base RPC / Solana RPC�� global fetch �� ��ġ�� �� �������� ��ü (�ǳ�Ʈ��ũ ��ȣ��)
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import * as secp from '@noble/secp256k1';
import { privateKeyToAccount } from 'viem/accounts';
import { transferEventTopic0 } from './src/walletAuth.js';
import worker, {
  getPlan,
  handleTopup,
  handleBaseTopup,
  x402PaymentRequiredResponse,
} from './src/worker.js';

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  | ' + extra : ''}`);
}

// ������ Mock KV ��������������������������������������������������������������������������������������������������������������������������������������
function createKV(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(key, opts) {
      const v = map.get(key);
      if (v === undefined) return null;
      if (opts && opts.type === 'json') {
        try { return JSON.parse(v); } catch { return null; }
      }
      return v;
    },
    async put(key, value, opts) { map.set(key, String(value)); },
    _map: map,
  };
}

// ������ Mock global fetch (RPC) ����������������������������������������������������������������������������������������������������
// handler: async (jsonRpcBody) => result | null | undefined(����)
function mockFetch(handler) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body || '{}');
    const result = await handler(body);
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: body.id !== undefined ? body.id : 1,
        result: result === undefined ? null : result,
      }),
    };
  };
  return () => { globalThis.fetch = orig; };
}

// ������ ��� (wrangler.toml�� ����) ��������������������������������������������������������������������������������������������
const SERVICE_WALLET = 'GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE_SERVICE_WALLET = '0x22E2076148c529981495c3C02A23DfB1D4f8Db9C';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_CHAIN_ID = 8453;
const TOPIC0 = transferEventTopic0().toLowerCase();

function makeEnv({ results = {}, apiKeys = {}, baseWallet = BASE_SERVICE_WALLET } = {}) {
  return {
    RESULTS_KV: createKV(results),
    API_KEYS: createKV(apiKeys),
    SERVICE_WALLET_ADDRESS: SERVICE_WALLET,
    USDC_MINT_ADDRESS: USDC_MINT,
    SOLANA_RPC_URL: 'https://rpc.mock.solana',
    BASE_CHAIN_ID: String(BASE_CHAIN_ID),
    BASE_RPC_URL: 'https://rpc.mock.base',
    BASE_USDC_ADDRESS: BASE_USDC,
    BASE_SERVICE_WALLET_ADDRESS: baseWallet,
  };
}

// ������ ���� ���� ����������������������������������������������������������������������������������������������������������������������������������
function solanaSign(ts) {
  const kp = nacl.sign.keyPair();
  const sig = nacl.sign.detached(new TextEncoder().encode(`x402:${ts}`), kp.secretKey);
  return { address: bs58.encode(kp.publicKey), sig: bs58.encode(sig) };
}

async function eip191Sign(ts) {
  const priv = secp.utils.bytesToHex(secp.utils.randomPrivateKey());
  const account = privateKeyToAccount(`0x${priv}`);
  const sig = await account.signMessage({ message: `x402:base:${ts}` });
  return { address: account.address.toLowerCase(), sig };
}

async function eip712Sign(ts) {
  const priv = secp.utils.bytesToHex(secp.utils.randomPrivateKey());
  const account = privateKeyToAccount(`0x${priv}`);
  const domain = { name: 'AZNP', version: '1', chainId: BASE_CHAIN_ID };
  const types = { X402Auth: [
    { name: 'message', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ] };
  const message = { message: 'x402', timestamp: BigInt(ts) };
  const sig = await account.signTypedData({ domain, types, primaryType: 'X402Auth', message });
  return { address: account.address.toLowerCase(), sig };
}

function baseRequest({ address, sig, ts, chain = 'base', sigType = 'eip191' }) {
  const h = new Headers();
  h.set('x-wallet-address', address);
  h.set('x-signature', sig);
  h.set('x-timestamp', String(ts));
  h.set('x-chain', chain);
  h.set('x-sig-type', sigType);
  return new Request('http://localhost/', { headers: h });
}

const now = Math.floor(Date.now() / 1000);

// ������ 1. /health ��Ƽü�� ����������������������������������������������������������������������������������������������������������������
{
  const env = makeEnv();
  const res = await worker.fetch(new Request('http://localhost/health'), env, {});
  const data = await res.json();
  check('health: auth Solana-first', data.auth === 'solana-ed25519', data.auth);
  check('health: version', data.version === '2.1');
}

// ������ 2. getPlan: Base EIP-191 ����������������������������������������������������������������������������������������������������
{
  const ts = now;
  const { address, sig } = await eip191Sign(ts);
  const env = makeEnv({ results: { [`acc:base:${address}:count`]: '5' } });
  const plan = await getPlan(baseRequest({ address, sig, ts, sigType: 'eip191' }), env);
  check('Base EIP-191: ��ȿ ����+ũ���� �� pro', plan.plan === 'pro');
  check('Base EIP-191: authType base_wallet', plan.authType === 'base_wallet');
  check('Base EIP-191: userId lowercase', plan.userId === address);
  check('Base EIP-191: ũ���� 1ȸ ����(5��4)', plan.remainingCount === 4 && plan.remainingCredits === 4);
  const stored = await env.RESULTS_KV.get(`acc:base:${address}:count`);
  check('Base EIP-191: KV�� 4 ����', stored === '4');
}

// ������ 3. getPlan: Base EIP-712 ����������������������������������������������������������������������������������������������������
{
  const ts = now;
  const { address, sig } = await eip712Sign(ts);
  const env = makeEnv({ results: { [`acc:base:${address}:count`]: '3' } });
  const plan = await getPlan(baseRequest({ address, sig, ts, sigType: 'eip712' }), env);
  check('Base EIP-712: ��ȿ ����+ũ���� �� pro', plan.plan === 'pro');
  check('Base EIP-712: authType base_wallet', plan.authType === 'base_wallet');
  check('Base EIP-712: ũ���� ����(3��2)', plan.remainingCount === 2);
}

// ������ 4. getPlan: Base �⺻�� (x-sig-type ������ �� EIP-191 �� EIP-712 ��õ�) ������������������
{
  const ts = now;
  const { address, sig } = await eip191Sign(ts);
  const env = makeEnv({ results: { [`acc:base:${address}:count`]: '2' } });
  const plan = await getPlan(baseRequest({ address, sig, ts, sigType: '' }), env);
  check('Base �⺻��(sig-type ����): EIP-191�� pro', plan.plan === 'pro');
}

// ������ 5. getPlan: Base ���� Ÿ�ӽ�����(>300s) �� pro �ƴ� ��������������������������������������������������
{
  const ts = now - 4000;
  const { address, sig } = await eip191Sign(ts);
  const env = makeEnv({ results: { [`acc:base:${address}:count`]: '5' } });
  const plan = await getPlan(baseRequest({ address, sig, ts, sigType: 'eip191' }), env);
  check('Base ���� ts: pro �ƴ�', plan.plan !== 'pro');
}

// ������ 6. getPlan: Base ����/����ġ ���� �� pro �ƴ� ����������������������������������������������������������������
{
  const ts = now;
  const { sig } = await eip191Sign(ts);
  const wrongAcc = '0x' + '11'.repeat(20);
  const env = makeEnv({ results: { [`acc:base:${wrongAcc}:count`]: '5' } });
  const plan = await getPlan(baseRequest({ address: wrongAcc, sig, ts, sigType: 'eip191' }), env);
  check('Base ����(�ּ� ����ġ): pro �ƴ�', plan.plan !== 'pro');
}

// ������ 7. getPlan: ü�� ��� (x-chain solana + 0x �ּ�) �� chain_mismatch ������������������
{
  const plan = await getPlan(
    baseRequest({ address: BASE_SERVICE_WALLET, sig: '0x1234', ts: now, chain: 'solana' }),
    makeEnv()
  );
  check('ü�� ���(solana+0x): chain_mismatch', plan.plan === 'chain_mismatch' && !!plan.error);
}

// ������ 8. getPlan: Solana ��� ȸ�� (ed25519 + acc:{wallet}:count) ��������������������������������
{
  const ts = now;
  const { address, sig } = solanaSign(ts);
  const env = makeEnv({ results: { [`acc:${address}:count`]: '7' } });
  const req = baseRequest({ address, sig, ts, chain: 'solana', sigType: 'ed25519' });
  const plan = await getPlan(req, env);
  check('Solana ed25519: ��ȿ ���� �� pro', plan.plan === 'pro');
  check('Solana ed25519: authType solana_wallet', plan.authType === 'solana_wallet');
  check('Solana ed25519: acc:{wallet}:count ����(7��6)', plan.remainingCount === 6);
}

// ������ 9. getPlan: API Key ��� ����������������������������������������������������������������������������������������������������
{
  const apiKey = 'aznp_pro_' + 'a'.repeat(32);
  const keyData = JSON.stringify({ plan: 'pro', status: 'active', userId: 'u-1' });
  const env = makeEnv({ apiKeys: { [apiKey]: keyData } });
  const req = new Request('http://localhost/', { headers: { 'X-API-Key': apiKey } });
  const plan = await getPlan(req, env);
  check('API Key: ��ȿ �� pro', plan.plan === 'pro' && plan.authType === 'api_key');
}

// ������ 10. getPlan: ���� ���� �� Free ������������������������������������������������������������������������������������������
{
  const plan = await getPlan(new Request('http://localhost/'), makeEnv());
  check('���� ���� �� free', plan.plan === 'free');
}

// ������ 11. handleBaseTopup: ���� (native USDC Transfer) ����������������������������������������������������
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + 'ab'.repeat(32);
  const amountWei = 20_000_000n; // 20 USDC (6 decimals)
  const receipt = {
    status: '0x1',
    logs: [{
      address: BASE_USDC.toLowerCase(),
      topics: [TOPIC0, wallet.toLowerCase(), BASE_SERVICE_WALLET.toLowerCase()],
      data: '0x' + amountWei.toString(16),
    }],
  };
  const restore = mockFetch(async (body) => {
    if (body.method === 'eth_getTransactionReceipt') return receipt;
    return null;
  });
  try {
    const env = makeEnv();
    const res = await handleBaseTopup(env, { wallet, tx_hash: txHash });
    const data = await res.json();
    check('Base topup: 200', res.status === 200 && data.success === true);
    check('Base topup: chain=base', data.chain === 'base');
    check('Base topup: ũ���� ����(20*600=12000)', data.added_credits === 12000);
    const dedup = await env.RESULTS_KV.get(`tx:base:${txHash}`);
    check('Base topup: �ߺ� Ű ����', dedup === 'processed');
    const count = await env.RESULTS_KV.get(`acc:base:${wallet}:count`);
    check('Base topup: acc:base:...:count = 12000', count === '12000');
  } finally { restore(); }
}

// ������ 12. handleBaseTopup: �ߺ� Ʈ����� �� 400 ����������������������������������������������������������������������
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + 'cd'.repeat(32);
  const env = makeEnv({ results: { [`tx:base:${txHash}`]: 'processed' } });
  const restore = mockFetch(async () => null);
  try {
    const res = await handleBaseTopup(env, { wallet, tx_hash: txHash });
    check('Base topup: �ߺ� tx �� 400', res.status === 400);
  } finally { restore(); }
}

// ������ 13. handleBaseTopup: �ּ� �ݾ� �̴� �� 400 ��������������������������������������������������������������������
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + '11'.repeat(32);
  const receipt = {
    status: '0x1',
    logs: [{
      address: BASE_USDC.toLowerCase(),
      topics: [TOPIC0, wallet.toLowerCase(), BASE_SERVICE_WALLET.toLowerCase()],
      data: '0x' + (10_000_000n).toString(16), // 10 USDC
    }],
  };
  const restore = mockFetch(async (body) => body.method === 'eth_getTransactionReceipt' ? receipt : null);
  try {
    const res = await handleBaseTopup(makeEnv(), { wallet, tx_hash: txHash });
    const data = await res.json();
    check('Base topup: 10 USDC �� 400', res.status === 400 && /Minimum deposit/i.test(data.error));
  } finally { restore(); }
}

// ������ 14. handleBaseTopup: USDbC/�ٸ� emitter �� 400 ������������������������������������������������������������
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + '22'.repeat(32);
  const usdbc = '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca';
  const receipt = {
    status: '0x1',
    logs: [{
      address: usdbc, // USDbC emitter �� native USDC
      topics: [TOPIC0, wallet.toLowerCase(), BASE_SERVICE_WALLET.toLowerCase()],
      data: '0x' + (100_000_000n).toString(16),
    }],
  };
  const restore = mockFetch(async (body) => body.method === 'eth_getTransactionReceipt' ? receipt : null);
  try {
    const res = await handleBaseTopup(makeEnv(), { wallet, tx_hash: txHash });
    const data = await res.json();
    check('Base topup: USDbC emitter �� 400', res.status === 400 && /native USDC Transfer not found/i.test(data.error));
  } finally { restore(); }
}

// ������ 15. handleBaseTopup: ���� ���� ����ġ �� 400 ������������������������������������������������������������������
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + '33'.repeat(32);
  const receipt = {
    status: '0x1',
    logs: [{
      address: BASE_USDC.toLowerCase(),
      topics: [TOPIC0, wallet.toLowerCase(), '0x' + '99'.repeat(20)], // wrong to
      data: '0x' + (100_000_000n).toString(16),
    }],
  };
  const restore = mockFetch(async (body) => body.method === 'eth_getTransactionReceipt' ? receipt : null);
  try {
    const res = await handleBaseTopup(makeEnv(), { wallet, tx_hash: txHash });
    check('Base topup: ������ ����ġ �� 400', res.status === 400);
  } finally { restore(); }
}

// ������ 16. handleBaseTopup: receipt ���� status �� 400 ����������������������������������������������������������
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + '44'.repeat(32);
  const receipt = { status: '0x0', logs: [] };
  const restore = mockFetch(async (body) => body.method === 'eth_getTransactionReceipt' ? receipt : null);
  try {
    const res = await handleBaseTopup(makeEnv(), { wallet, tx_hash: txHash });
    check('Base topup: status=0x0 �� 400', res.status === 400);
  } finally { restore(); }
}

// ������ 17. handleTopup: Solana ȸ�� (chain ������ + base58 �� solana) ����������������������������
{
  const solWallet = '7xKXq8BvhJoMd5R1mJVXLLQGTzxx8fKtU8ZCBiRHPkky';
  const txHash = '5y7FTEzY1VtQ7F9jY9XgWvQTPYtRjVwSL1dbqxsA7YvA';
  const tx = {
    meta: {
      err: null,
      postTokenBalances: [{ owner: SERVICE_WALLET, mint: USDC_MINT, uiTokenAmount: { uiAmount: 25 } }],
      preTokenBalances: [{ owner: SERVICE_WALLET, mint: USDC_MINT, uiTokenAmount: { uiAmount: 0 } }],
    },
  };
  const restore = mockFetch(async (body) => body.method === 'getTransaction' ? tx : null);
  try {
    const env = makeEnv();
    const res = await handleTopup(new Request('http://localhost/v1/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: solWallet, tx_hash: txHash }),
    }), env);
    const data = await res.json();
    check('Solana topup: chain ������+base58 �� solana', data.chain === 'solana');
    check('Solana topup: 200 + ũ����(25*600=15000)', res.status === 200 && data.added_credits === 15000);
  } finally { restore(); }
}

// ������ 18. handleTopup: ü�� ��� (chain solana + 0x wallet) �� 400 ��������������������������������
{
  const res = await handleTopup(new Request('http://localhost/v1/topup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain: 'solana', wallet: BASE_SERVICE_WALLET, tx_hash: '0x' + 'ab'.repeat(31) + 'cd' }),
  }), makeEnv());
  check('handleTopup: solana+0x ���� �� 400', res.status === 400);
}

// ������ 19. x402PaymentRequiredResponse: networks + service_wallet ��������������������������������
{
  const env = makeEnv();
  const res = x402PaymentRequiredResponse(env);
  const data = await res.json();
  check('402: �ֻ��� service_wallet ����', data.service_wallet === SERVICE_WALLET);
  check('402: �ֻ��� network=solana ����', data.network === 'solana');
  check('402: networks �迭 ����', Array.isArray(data.networks) && data.networks.length >= 2);
  const base = data.networks.find(n => n.network === 'base');
  check('402: networks�� base ����', !!base && base.service_wallet === BASE_SERVICE_WALLET);
  check('402: networks�� solana ����', data.networks.some(n => n.network === 'solana'));
  const prHeader = res.headers.get('PAYMENT-REQUIRED');
  check('402: PAYMENT-REQUIRED ����� networks ����', !!prHeader && JSON.parse(prHeader).networks.length >= 2);
}

// ============ TASKS 2.6: AI Agent 응답 포맷 · max_tokens · LLM 에러 ============
// mock fetch(HTML) + mock Cache API만 사용. 실네트워크 없음, npm test에 포함.
{
  const cacheMap = new Map();
  const origCaches = globalThis.caches;
  const origFetch = globalThis.fetch;
  const htmlBase =
    '<html><head><title>Fixture</title></head><body><h1>Fixture Title</h1>' +
    Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i} lorem ipsum dolor sit amet consectetur.</p>`).join('') +
    '</body></html>';
  const PRO_KEY = 'aznp_pro_test00000000000000';

  // 요청마다 새 env를 만든다. worker가 ctx.waitUntil로 넘긴 IIFE(캐시/KV 저장)는
  // 동기 실행이라 요청 간 공유 KV/env는 다음 요청 결과를 오염시킬 수 있음 (프로덕션은
  // Cloudflare가 waitUntil 수명을 관리하지만 테스트는 요청별 격리가 필요).
  async function runPipe(query, { env = null, apiKey = '', html = htmlBase, path = '/' } = {}) {
    env = env || (apiKey
      ? makeEnv({ apiKeys: { [apiKey]: JSON.stringify({ userId: 'u1', plan: 'pro', status: 'active' }) } })
      : makeEnv());
    globalThis.caches = {
      default: {
        match: async (k) => cacheMap.get(typeof k === 'string' ? k : k.url) || null,
        put: async (k, res) => {
          try {
            cacheMap.set(typeof k === 'string' ? k : k.url, {
              status: res.status,
              body: await res.clone().text(),
              contentType: res.headers.get('Content-Type'),
            });
          } catch { /* ignore */ }
        },
      },
    };
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => html,
      json: async () => ({}),
    });
    const qs = new URLSearchParams(query);
    const headers = apiKey ? { 'X-API-Key': apiKey } : {};
    try {
      return await worker.fetch(new Request(`http://localhost${path}?${qs}`, { headers }), env, { waitUntil() {} });
    } finally {
      globalThis.fetch = origFetch;
      globalThis.caches = origCaches;
      cacheMap.clear();
    }
  }

  // 1) 기본 GET → text/markdown (Free)
  {
    const res = await runPipe({ url: 'https://example.com/post' });
    const body = await res.text();
    check('2.6 GET: 200 + text/markdown', res.status === 200 && (res.headers.get('content-type') || '').includes('text/markdown'));
    check('2.6 GET: markdown 본문 (H1 + Source 포함)', body.includes('Fixture Title') && body.includes('*Source: https://example.com/post*'));
  }

  // 2) format=toml (Pro) — title/source/content 존재
  {
    const res = await runPipe({ url: 'https://example.com/post', format: 'toml' }, { apiKey: PRO_KEY });
    const body = await res.text();
    check('2.6 toml: 200 + application/toml', res.status === 200 && (res.headers.get('content-type') || '').includes('application/toml'));
    check('2.6 toml: title/source/content', body.includes('title = "Fixture"') && body.includes('source = "https://example.com/post"') && body.includes('content = """'));
    check('2.6 toml: [meta] plan pro', body.includes('[meta]') && body.includes('plan = "pro"'));
  }

  // 3) format=yaml (Pro) — flat 스키마가 정본 (TASKS 2.6)
  {
    const res = await runPipe({ url: 'https://example.com/post', format: 'yaml' }, { apiKey: PRO_KEY });
    const body = await res.text();
    check('2.6 yaml: 200 + application/yaml', res.status === 200 && (res.headers.get('content-type') || '').includes('application/yaml'));
    check('2.6 yaml: title/source + literal block(content: |)', body.includes('title: "Fixture"') && body.includes('source: "https://example.com/post"') && body.includes('content: |'));
  }

  // 4) format=json-ld (Pro) — @context / @type = Article
  {
    const res = await runPipe({ url: 'https://example.com/post', format: 'json-ld' }, { apiKey: PRO_KEY });
    const data = JSON.parse(await res.text());
    check('2.6 json-ld: @type Article', data['@type'] === 'Article' && data['@context'] === 'https://schema.org');
    check('2.6 json-ld: url/headline', data.url === 'https://example.com/post' && !!data.headline);
  }

  // 5) format=json (Pro) — 기존 { title, source, content, meta } 하위 호환
  {
    const res = await runPipe({ url: 'https://example.com/post', format: 'json' }, { apiKey: PRO_KEY });
    const data = await res.json();
    check('2.6 json: title/source/content', !!data.title && data.source === 'https://example.com/post' && !!data.content);
    check('2.6 json: meta.plan pro', data.meta && data.meta.plan === 'pro');
  }

  // 6) format=xml 등 미지원 → 400 unsupported_format (기본 TOML 에러)
  {
    const res = await runPipe({ url: 'https://example.com/post', format: 'xml' });
    const body = await res.text();
    check('2.6 unsupported: 400 + code', res.status === 400 && body.includes('unsupported_format') && body.includes('action_recommendation'));
    check('2.6 unsupported: 기본 TOML(JSON 아님)', !body.trim().startsWith('{'));
  }

  // 7) Free + 구조화 포맷 → 200 (TASKS 3.3 convert 무료화: 402 아님)
  {
    const contentTypes = { json: 'application/json', toml: 'application/toml', yaml: 'application/yaml', 'json-ld': 'application/ld+json' };
    for (const fmt of ['json', 'toml', 'yaml', 'json-ld']) {
      const res = await runPipe({ url: 'https://example.com/post', format: fmt });
      const body = await res.text();
      check(`3.3 free+${fmt}: 200 + ${contentTypes[fmt]}`, res.status === 200 && (res.headers.get('content-type') || '').includes(contentTypes[fmt]));
      check(`3.3 free+${fmt}: 본문 존재(402 아님)`, body.length > 50 && !res.headers.has('PAYMENT-REQUIRED'));
    }
  }

  // 8) 없는 경로 → 404 TOML [error] + action_recommendation (JSON 아님)
  {
    const res = await runPipe({}, { path: '/nonexistent' });
    const body = await res.text();
    check('2.6 404: TOML [error] + action_recommendation', res.status === 404 && body.includes('[error]') && body.includes('action_recommendation') && !body.trim().startsWith('{'));
  }

  // 9) format=json 요청의 400/404 → JSON 에러
  {
    const res = await runPipe({ format: 'json' }, { path: '/nonexistent' });
    const body = await res.text();
    let j = null; try { j = JSON.parse(body); } catch { /* */ }
    check('2.6 404+format=json: JSON error.code', res.status === 404 && j && j.error && j.error.code === 'not_found');
  }
  {
    const res = await runPipe({ format: 'json' });
    const body = await res.text();
    let j = null; try { j = JSON.parse(body); } catch { /* */ }
    check('2.6 400+format=json: JSON error.code', res.status === 400 && j && j.error && j.error.code === 'missing_url');
  }

  // 10) max_tokens=2000 (Pro): 긴 픽스처에서 est<=2000, H1 유지, 전체 본문 미절단
  {
    const res = await runPipe({ url: 'https://example.com/long', max_tokens: '2000' }, { apiKey: PRO_KEY });
    const body = await res.text();
    const est = Math.ceil(body.length / 4);
    check('2.6 max_tokens=2000: est <= 2000', est <= 2000, 'est=' + est);
    check('2.6 max_tokens=2000: H1 유지', body.includes('# Fixture'));
    check('2.6 max_tokens=2000: 전체 본문 유지(미절단)', body.includes('Paragraph 59'));
  }

  // 10-b) max_tokens=200 (Pro): 블록 단위 절단, H1 유지, 문장 중간 slice 아님
  {
    const res = await runPipe({ url: 'https://example.com/long', max_tokens: '200' }, { apiKey: PRO_KEY });
    const body = await res.text();
    const est = Math.ceil(body.length / 4);
    check('2.6 max_tokens=200: est <= 200', est <= 200, 'est=' + est);
    check('2.6 max_tokens=200: 절단 마커 존재', body.includes('truncated by max_tokens'));
    check('2.6 max_tokens=200: H1 첫 블록 유지', body.startsWith('# Fixture'));
    const core = body.split('... (truncated by max_tokens)')[0];
    check('2.6 max_tokens=200: 문장 중간 slice 아님', core.trimEnd().split('\n').pop().endsWith('.'));
  }

  // 11) 동일 URL에 max_tokens=500 vs 2000 → 캐시 키 분리로 서로 다른 본문
  {
    const b1 = (await (await runPipe({ url: 'https://example.com/dist', max_tokens: '500' }, { apiKey: PRO_KEY })).text()).length;
    const b2 = (await (await runPipe({ url: 'https://example.com/dist', max_tokens: '2000' }, { apiKey: PRO_KEY })).text()).length;
    check('2.6 max_tokens: 500 vs 2000 서로 다른 본문', b1 !== b2, 'b1=' + b1 + ' b2=' + b2);
  }

  // 12) max_tokens 없이 요청 → 기존 전체 본문 (회귀)
  {
    const res = await runPipe({ url: 'https://example.com/post' });
    const body = await res.text();
    check('2.6 max_tokens 미지정: 전체 본문(Paragraph 59 존재)', body.includes('Paragraph 59'));
  }

  // 13) Free + max_tokens → 200 (TASKS 3.3 무료화, truncate 동작)
  {
    const res = await runPipe({ url: 'https://example.com/long', max_tokens: '200' });
    const body = await res.text();
    check('3.3 free+max_tokens: 200(402 아님)', res.status === 200 && !res.headers.has('PAYMENT-REQUIRED'));
    check('3.3 free+max_tokens: truncate 적용', Math.ceil(body.length / 4) <= 200 && body.includes('truncated by max_tokens'));
  }

  // 14) max_tokens > 100000 → 400 max_tokens_too_large (TASKS 2.2)
  {
    const res = await runPipe({ url: 'https://example.com/long', max_tokens: '200000' });
    const body = await res.text();
    check('2.2 max_tokens 상한: 400 + code', res.status === 400 && body.includes('max_tokens_too_large') && body.includes('action_recommendation'));
  }
}

// ============ TASKS 3.4: 발견 엔드포인트 (인증 불필요 200 · 캐시 키 미사용) ============
{
  const res = await worker.fetch(new Request('http://localhost/llms.txt'), makeEnv(), {});
  const body = await res.text();
  check('3.4 /llms.txt: 200 + text/plain', res.status === 200 && (res.headers.get('content-type') || '').includes('text/plain'));
  check('3.4 /llms.txt: Solana-first 카피', body.includes('Solana') && body.includes('free') && body.includes('x-signature'));
}

{
  const res = await worker.fetch(new Request('http://localhost/llms-full.txt'), makeEnv(), {});
  const body = await res.text();
  check('3.4 /llms-full.txt: 200 + 쿼리/에러 코드 포함', res.status === 200 && body.includes('max_tokens') && body.includes('fetch_failed'));
}

{
  const res = await worker.fetch(new Request('http://localhost/openapi.json'), makeEnv(), {});
  const data = await res.json();
  check('3.4 /openapi.json: 200 + openapi 3.0.3', res.status === 200 && data.openapi === '3.0.3');
  check('3.4 /openapi.json: GET / + /health 경로', !!data.paths['/']?.get && !!data.paths['/health']?.get);
  check('3.4 /openapi.json: topup 미표기(그랜트 제품 아님)', !JSON.stringify(data).includes('/v1/topup'));
}

{
  const res = await worker.fetch(new Request('http://localhost/robots.txt'), makeEnv(), {});
  check('3.4 /robots.txt: 200 + text/plain', res.status === 200 && (res.headers.get('content-type') || '').includes('text/plain'));
}

// ===========

const failed = results.filter(r => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
if (failed.length) {
  console.log('FAILED:', failed.map(f => f.name).join('\n  - '));
  process.exit(1);
}
