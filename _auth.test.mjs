import nacl from 'tweetnacl';
import bs58 from 'bs58';
import * as secp from '@noble/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { hashTypedData, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  verifySolanaSignature,
  verifyEip191Signature,
  verifyEip712Signature,
  computeEip712Digest,
  resolveChain,
  isBaseAddress,
  isBaseTxHash,
  normalizeBaseAddress,
  USDB_C_ADDRESS,
  transferEventTopic0,
} from './src/walletAuth.js';

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  | ' + extra : ''}`);
}

// Solana
{
  const ts = Math.floor(Date.now() / 1000).toString();
  const kp = nacl.sign.keyPair();
  const msg = new TextEncoder().encode(`x402:${ts}`);
  const sig = nacl.sign.detached(msg, kp.secretKey);
  const sigB58 = bs58.encode(sig);
  const pubB58 = bs58.encode(kp.publicKey);
  check('Solana: valid sig', verifySolanaSignature(`x402:${ts}`, sigB58, pubB58));
  check('Solana: invalid sig', !verifySolanaSignature(`x402:${ts}`, bs58.encode(new Uint8Array(64)), pubB58));
}

// Chain resolution
{
  const evm = '0xAbC1234567890abcdef1234567890abcdef12345';
  const sol = '7xKXq8BvhJoMd5R1mJVXLLQGTzxx8fKtU8ZCBiRHPkky';
  check('Base address', isBaseAddress(evm) && !isBaseAddress(sol));
  check('Base tx hash', isBaseTxHash('0x' + 'ab'.repeat(32)) && !isBaseTxHash('0x1234'));
  check('Base address normalize', normalizeBaseAddress(evm) === '0xabc1234567890abcdef1234567890abcdef12345');
  check('resolve chain: x-chain solana + 0x addr -> error', !!resolveChain({ declared: 'solana', address: evm }).error);
  check('resolve chain: x-chain base + solana addr -> error', !!resolveChain({ declared: 'base', address: sol }).error);
  check('resolve chain: no x-chain + 0x addr -> base', resolveChain({ declared: undefined, address: evm }).chain === 'base');
  check('resolve chain: no x-chain + solana addr -> solana', resolveChain({ declared: undefined, address: sol }).chain === 'solana');
  check('resolve chain: x-chain base + 0x addr -> base', resolveChain({ declared: 'base', address: evm }).chain === 'base');
}
// Base EIP-191
{
  const priv = secp.utils.bytesToHex(secp.utils.randomPrivateKey());
  const account = privateKeyToAccount(`0x${priv}`);
  const ts = Math.floor(Date.now() / 1000).toString();
  const msg = `x402:base:${ts}`;
  const sig = await account.signMessage({ message: msg });
  check('EIP-191: viem sign -> verify', verifyEip191Signature(msg, sig, account.address.toLowerCase()));
  check('EIP-191: wrong addr', !verifyEip191Signature(msg, sig, '0x' + '00'.repeat(20)));
  check('EIP-191: bad sig', !verifyEip191Signature(msg, '0x1234', account.address.toLowerCase()));
  // cross-chain binding: solana msg should not verify as base
  const solMsg = `x402:${ts}`;
  check('EIP-191: solana msg as base -> false', !verifyEip191Signature(solMsg, sig, account.address.toLowerCase()));
}

// Base EIP-712
{
  const domain = { name: 'AZNP', version: '1', chainId: 8453 };
  const types = {
    X402Auth: [
      { name: 'message', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
    ],
  };
  const ts = Math.floor(Date.now() / 1000);
  const message = { message: 'x402', timestamp: BigInt(ts) };
  // our digest vs viem
  const ourDigest = '0x' + Array.from(computeEip712Digest(ts, 8453), b => b.toString(16).padStart(2, '0')).join('');
  const viemDigest = hashTypedData({ domain, types, primaryType: 'X402Auth', message });
  check('EIP-712: digest matches viem', ourDigest.toLowerCase() === viemDigest.toLowerCase());
  // viem sign -> our verify
  const priv = secp.utils.bytesToHex(secp.utils.randomPrivateKey());
  const account = privateKeyToAccount(`0x${priv}`);
  const sig = await account.signTypedData({ domain, types, primaryType: 'X402Auth', message });
  check('EIP-712: viem sign -> verify', verifyEip712Signature({ timestamp: ts, signatureHex: sig, addressLower: account.address.toLowerCase(), chainId: 8453 }));
  check('EIP-712: wrong addr', !verifyEip712Signature({ timestamp: ts, signatureHex: sig, addressLower: '0x' + '11'.repeat(20), chainId: 8453 }));
  const recovered = await recoverTypedDataAddress({ domain, types, primaryType: 'X402Auth', message, signature: sig });
  check('EIP-712: recovered address matches', String(recovered).toLowerCase() === account.address.toLowerCase());
  // replay protection
  check('EIP-712: replay (ts+1) -> false', !verifyEip712Signature({ timestamp: ts + 1, signatureHex: sig, addressLower: account.address.toLowerCase(), chainId: 8453 }));
}
// Base EIP-191 low-level (noble)
{
  const priv = secp.utils.bytesToHex(secp.utils.randomPrivateKey());
  const account = privateKeyToAccount(`0x${priv}`);
  const ts = Math.floor(Date.now() / 1000).toString();
  const msg = `x402:base:${ts}`;
  const msgBytes = new TextEncoder().encode(msg);
  const prefix = new TextEncoder().encode('\x19Ethereum Signed Message:\n');
  const lenBytes = new TextEncoder().encode(String(msgBytes.length));
  const digest = keccak_256(Uint8Array.from([...prefix, ...lenBytes, ...msgBytes]));
  const [sigCompact, recovery] = await secp.sign(digest, priv, { der: false, recovered: true });
  const sig65 = `0x${Array.from(sigCompact, b => b.toString(16).padStart(2, '0')).join('')}${(27 + recovery).toString(16).padStart(2, '0')}`;
  check('EIP-191: noble sig (v=27/28) -> verify', verifyEip191Signature(msg, sig65, account.address.toLowerCase()));
  const sig6501 = `0x${Array.from(sigCompact, b => b.toString(16).padStart(2, '0')).join('')}${recovery.toString(16).padStart(2, '0')}`;
  check('EIP-191: noble sig (v=0/1) normalized -> verify', verifyEip191Signature(msg, sig6501, account.address.toLowerCase()));
}

const failed = results.filter(r => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
if (failed.length) {
  console.log('FAILED:', failed.map(f => f.name).join('\n  - '));
  process.exit(1);
}


