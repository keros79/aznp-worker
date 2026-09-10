/**
 * AZNP ¸ÖÆ¼Ã¼ÀÎ ÅëÇÕ Å×½ºÆ® (mock KV + mock RPC)
 *
 * ´ë»ó: src/worker.js ³»ºÎ ÇÔ¼ö (getPlan / handleTopup / handleBaseTopup /
 *       callBaseRpc / x402PaymentRequiredResponse) + ±âº» fetch ¶ó¿ìÆÃ(/health)
 *
 * ½ÇÇà: node _integration.test.mjs
 *  - Base RPC / Solana RPC´Â global fetch ¸¦ ÆÐÄ¡ÇØ ¸ñ ÀÀ´äÀ¸·Î ´ëÃ¼ (½Ç³×Æ®¿öÅ© ¹«È£Ãâ)
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

// ¦¡¦¡¦¡ Mock KV ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
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

// ¦¡¦¡¦¡ Mock global fetch (RPC) ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
// handler: async (jsonRpcBody) => result | null | undefined(¿¡·¯)
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

// ¦¡¦¡¦¡ »ó¼ö (wrangler.toml°ú µ¿ÀÏ) ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
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

// ¦¡¦¡¦¡ ¼­¸í ÇïÆÛ ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
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

// ¦¡¦¡¦¡ 1. /health ¸ÖÆ¼Ã¼ÀÎ ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const env = makeEnv();
  const res = await worker.fetch(new Request('http://localhost/health'), env, {});
  const data = await res.json();
  check('health: auth multi-chain', data.auth === 'solana-ed25519+base-eip191', data.auth);
  check('health: version', data.version === '2.1');
}

// ¦¡¦¡¦¡ 2. getPlan: Base EIP-191 ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const ts = now;
  const { address, sig } = await eip191Sign(ts);
  const env = makeEnv({ results: { [`acc:base:${address}:count`]: '5' } });
  const plan = await getPlan(baseRequest({ address, sig, ts, sigType: 'eip191' }), env);
  check('Base EIP-191: À¯È¿ ¼­¸í+Å©·¹µ÷ ¡æ pro', plan.plan === 'pro');
  check('Base EIP-191: authType base_wallet', plan.authType === 'base_wallet');
  check('Base EIP-191: userId lowercase', plan.userId === address);
  check('Base EIP-191: Å©·¹µ÷ 1È¸ Â÷°¨(5¡æ4)', plan.remainingCount === 4 && plan.remainingCredits === 4);
  const stored = await env.RESULTS_KV.get(`acc:base:${address}:count`);
  check('Base EIP-191: KV¿¡ 4 ÀúÀå', stored === '4');
}

// ¦¡¦¡¦¡ 3. getPlan: Base EIP-712 ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const ts = now;
  const { address, sig } = await eip712Sign(ts);
  const env = makeEnv({ results: { [`acc:base:${address}:count`]: '3' } });
  const plan = await getPlan(baseRequest({ address, sig, ts, sigType: 'eip712' }), env);
  check('Base EIP-712: À¯È¿ ¼­¸í+Å©·¹µ÷ ¡æ pro', plan.plan === 'pro');
  check('Base EIP-712: authType base_wallet', plan.authType === 'base_wallet');
  check('Base EIP-712: Å©·¹µ÷ Â÷°¨(3¡æ2)', plan.remainingCount === 2);
}

// ¦¡¦¡¦¡ 4. getPlan: Base ±âº»°ª (x-sig-type ¹ÌÁöÁ¤ ¡æ EIP-191 ÈÄ EIP-712 Àç½Ãµµ) ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const ts = now;
  const { address, sig } = await eip191Sign(ts);
  const env = makeEnv({ results: { [`acc:base:${address}:count`]: '2' } });
  const plan = await getPlan(baseRequest({ address, sig, ts, sigType: '' }), env);
  check('Base ±âº»°ª(sig-type ¾øÀ½): EIP-191·Î pro', plan.plan === 'pro');
}

// ¦¡¦¡¦¡ 5. getPlan: Base ¸¸·á Å¸ÀÓ½ºÅÆÇÁ(>300s) ¡æ pro ¾Æ´Ô ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const ts = now - 4000;
  const { address, sig } = await eip191Sign(ts);
  const env = makeEnv({ results: { [`acc:base:${address}:count`]: '5' } });
  const plan = await getPlan(baseRequest({ address, sig, ts, sigType: 'eip191' }), env);
  check('Base ¸¸·á ts: pro ¾Æ´Ô', plan.plan !== 'pro');
}

// ¦¡¦¡¦¡ 6. getPlan: Base À§Á¶/ºÒÀÏÄ¡ ¼­¸í ¡æ pro ¾Æ´Ô ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const ts = now;
  const { sig } = await eip191Sign(ts);
  const wrongAcc = '0x' + '11'.repeat(20);
  const env = makeEnv({ results: { [`acc:base:${wrongAcc}:count`]: '5' } });
  const plan = await getPlan(baseRequest({ address: wrongAcc, sig, ts, sigType: 'eip191' }), env);
  check('Base À§Á¶(ÁÖ¼Ò ºÒÀÏÄ¡): pro ¾Æ´Ô', plan.plan !== 'pro');
}

// ¦¡¦¡¦¡ 7. getPlan: Ã¼ÀÎ ¸ð¼ø (x-chain solana + 0x ÁÖ¼Ò) ¡æ chain_mismatch ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const plan = await getPlan(
    baseRequest({ address: BASE_SERVICE_WALLET, sig: '0x1234', ts: now, chain: 'solana' }),
    makeEnv()
  );
  check('Ã¼ÀÎ ¸ð¼ø(solana+0x): chain_mismatch', plan.plan === 'chain_mismatch' && !!plan.error);
}

// ¦¡¦¡¦¡ 8. getPlan: Solana °æ·Î È¸±Í (ed25519 + acc:{wallet}:count) ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const ts = now;
  const { address, sig } = solanaSign(ts);
  const env = makeEnv({ results: { [`acc:${address}:count`]: '7' } });
  const req = baseRequest({ address, sig, ts, chain: 'solana', sigType: 'ed25519' });
  const plan = await getPlan(req, env);
  check('Solana ed25519: À¯È¿ ¼­¸í ¡æ pro', plan.plan === 'pro');
  check('Solana ed25519: authType solana_wallet', plan.authType === 'solana_wallet');
  check('Solana ed25519: acc:{wallet}:count Â÷°¨(7¡æ6)', plan.remainingCount === 6);
}

// ¦¡¦¡¦¡ 9. getPlan: API Key °æ·Î ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const apiKey = 'aznp_pro_' + 'a'.repeat(32);
  const keyData = JSON.stringify({ plan: 'pro', status: 'active', userId: 'u-1' });
  const env = makeEnv({ apiKeys: { [apiKey]: keyData } });
  const req = new Request('http://localhost/', { headers: { 'X-API-Key': apiKey } });
  const plan = await getPlan(req, env);
  check('API Key: À¯È¿ ¡æ pro', plan.plan === 'pro' && plan.authType === 'api_key');
}

// ¦¡¦¡¦¡ 10. getPlan: ÀÎÁõ ¾øÀ½ ¡æ Free ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const plan = await getPlan(new Request('http://localhost/'), makeEnv());
  check('ÀÎÁõ ¾øÀ½ ¡æ free', plan.plan === 'free');
}

// ¦¡¦¡¦¡ 11. handleBaseTopup: ¼º°ø (native USDC Transfer) ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
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
    check('Base topup: Å©·¹µ÷ Àû¸³(20*600=12000)', data.added_credits === 12000);
    const dedup = await env.RESULTS_KV.get(`tx:base:${txHash}`);
    check('Base topup: Áßº¹ Å° ÀúÀå', dedup === 'processed');
    const count = await env.RESULTS_KV.get(`acc:base:${wallet}:count`);
    check('Base topup: acc:base:...:count = 12000', count === '12000');
  } finally { restore(); }
}

// ¦¡¦¡¦¡ 12. handleBaseTopup: Áßº¹ Æ®·£Àè¼Ç ¡æ 400 ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + 'cd'.repeat(32);
  const env = makeEnv({ results: { [`tx:base:${txHash}`]: 'processed' } });
  const restore = mockFetch(async () => null);
  try {
    const res = await handleBaseTopup(env, { wallet, tx_hash: txHash });
    check('Base topup: Áßº¹ tx ¡æ 400', res.status === 400);
  } finally { restore(); }
}

// ¦¡¦¡¦¡ 13. handleBaseTopup: ÃÖ¼Ò ±Ý¾× ¹Ì´Þ ¡æ 400 ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
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
    check('Base topup: 10 USDC ¡æ 400', res.status === 400 && /Minimum deposit/i.test(data.error));
  } finally { restore(); }
}

// ¦¡¦¡¦¡ 14. handleBaseTopup: USDbC/´Ù¸¥ emitter ¡æ 400 ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + '22'.repeat(32);
  const usdbc = '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca';
  const receipt = {
    status: '0x1',
    logs: [{
      address: usdbc, // USDbC emitter ¡Á native USDC
      topics: [TOPIC0, wallet.toLowerCase(), BASE_SERVICE_WALLET.toLowerCase()],
      data: '0x' + (100_000_000n).toString(16),
    }],
  };
  const restore = mockFetch(async (body) => body.method === 'eth_getTransactionReceipt' ? receipt : null);
  try {
    const res = await handleBaseTopup(makeEnv(), { wallet, tx_hash: txHash });
    const data = await res.json();
    check('Base topup: USDbC emitter ¡æ 400', res.status === 400 && /native USDC Transfer not found/i.test(data.error));
  } finally { restore(); }
}

// ¦¡¦¡¦¡ 15. handleBaseTopup: ¼ö½Å Áö°© ºÒÀÏÄ¡ ¡æ 400 ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
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
    check('Base topup: ¼ö½ÅÀÚ ºÒÀÏÄ¡ ¡æ 400', res.status === 400);
  } finally { restore(); }
}

// ¦¡¦¡¦¡ 16. handleBaseTopup: receipt ½ÇÆÐ status ¡æ 400 ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const wallet = (await eip191Sign(now)).address;
  const txHash = '0x' + '44'.repeat(32);
  const receipt = { status: '0x0', logs: [] };
  const restore = mockFetch(async (body) => body.method === 'eth_getTransactionReceipt' ? receipt : null);
  try {
    const res = await handleBaseTopup(makeEnv(), { wallet, tx_hash: txHash });
    check('Base topup: status=0x0 ¡æ 400', res.status === 400);
  } finally { restore(); }
}

// ¦¡¦¡¦¡ 17. handleTopup: Solana È¸±Í (chain ¹ÌÁöÁ¤ + base58 ¡æ solana) ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
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
    check('Solana topup: chain ¹ÌÁöÁ¤+base58 ¡æ solana', data.chain === 'solana');
    check('Solana topup: 200 + Å©·¹µ÷(25*600=15000)', res.status === 200 && data.added_credits === 15000);
  } finally { restore(); }
}

// ¦¡¦¡¦¡ 18. handleTopup: Ã¼ÀÎ ¸ð¼ø (chain solana + 0x wallet) ¡æ 400 ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const res = await handleTopup(new Request('http://localhost/v1/topup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain: 'solana', wallet: BASE_SERVICE_WALLET, tx_hash: '0x' + 'ab'.repeat(31) + 'cd' }),
  }), makeEnv());
  check('handleTopup: solana+0x Áö°© ¡æ 400', res.status === 400);
}

// ¦¡¦¡¦¡ 19. x402PaymentRequiredResponse: networks + service_wallet ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
{
  const env = makeEnv();
  const res = x402PaymentRequiredResponse(env);
  const data = await res.json();
  check('402: ÃÖ»óÀ§ service_wallet À¯Áö', data.service_wallet === SERVICE_WALLET);
  check('402: ÃÖ»óÀ§ network=solana À¯Áö', data.network === 'solana');
  check('402: networks ¹è¿­ Á¸Àç', Array.isArray(data.networks) && data.networks.length >= 2);
  const base = data.networks.find(n => n.network === 'base');
  check('402: networks¿¡ base Æ÷ÇÔ', !!base && base.service_wallet === BASE_SERVICE_WALLET);
  check('402: networks¿¡ solana Æ÷ÇÔ', data.networks.some(n => n.network === 'solana'));
  const prHeader = res.headers.get('PAYMENT-REQUIRED');
  check('402: PAYMENT-REQUIRED Çì´õ¿¡ networks Æ÷ÇÔ', !!prHeader && JSON.parse(prHeader).networks.length >= 2);
}

// ¦¡¦¡¦¡ 20. ÃÖÁ¾ °á°ú Áý°è ¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡¦¡
const failed = results.filter(r => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
if (failed.length) {
  console.log('FAILED:', failed.map(f => f.name).join('\n  - '));
  process.exit(1);
}
