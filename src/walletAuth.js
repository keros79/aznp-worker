/**
 * AZNP 멀티체인 지갑 인증 헬퍼 (walletAuth)
 * - Solana: Ed25519 + Base58 (tweetnacl / bs58) — 기존 `verifySolanaSignature` 동작 유지
 * - Base (EVM L2): EIP-191 `personal_sign` / EIP-712 typed data — secp256k1 ecrecover
 *
 * 의존성:
 * - `@noble/hashes` — keccak_256 (EVM 메시지 해시)
 * - `@noble/secp256k1` — recoverPublicKey (경량 ecrecover, Workers 호환)
 *
 * 참조: docs/AZNP_Payment_Integration_Guide.md 섹션 3 · 4 (v2.1)
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { keccak_256 } from '@noble/hashes/sha3';
import * as secp256k1 from '@noble/secp256k1';

// ─── 상수 ─────────────────────────────────────────────────────────────────────

export const BASE_CHAIN_ID_DEFAULT = 8453;
// USDbC (브릿지 USDC) — native USDC가 아니므로 입금 거부 대상
export const USDB_C_ADDRESS = '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA';

const BASE_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BASE_TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// EIP-191 프리픽스: "\x19Ethereum Signed Message:\n" + len + message
const EIP191_PREFIX = '\x19Ethereum Signed Message:\n';

// EIP-712 고정 스키마 (가이드 섹션 4.3 — verifyingContract 없음)
const EIP712_DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId)';
const EIP712_MESSAGE_TYPE = 'X402Auth(string message,uint256 timestamp)';
const EIP712_DOMAIN_NAME = 'AZNP';
const EIP712_DOMAIN_VERSION = '1';

// ERC-20 Transfer(address,address,uint256) 이벤트 시그니처 (topic0)
const TRANSFER_EVENT_TOPIC0 = '0x' + bytesToHex(
  keccak_256(new TextEncoder().encode('Transfer(address,address,uint256)'))
);

const textEncoder = new TextEncoder();

// ─── 바이트 유틸 ──────────────────────────────────────────────────────────────

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function concatBytes(arrays) {
  let total = 0;
  for (const arr of arrays) total += arr.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function uint256Bytes(value) {
  // uint256 (32바이트 big-endian) 인코딩
  const out = new Uint8Array(32);
  let v = BigInt(value);
  if (v < 0n) {
    throw new Error('uint256 overflow: negative value');
  }
  if (v >> 256n !== 0n) {
    throw new Error('uint256 overflow: value too large');
  }
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 255n);
    v >>= 8n;
  }
  return out;
}

function keccakString(str) {
  return keccak_256(textEncoder.encode(str));
}

// ─── 주소 / 체인 판별 ─────────────────────────────────────────────────────────

export function isBaseAddress(addr) {
  return typeof addr === 'string' && BASE_ADDRESS_RE.test(addr);
}

export function isBaseTxHash(hash) {
  return typeof hash === 'string' && BASE_TX_HASH_RE.test(hash);
}

export function isSolanaAddress(addr) {
  return typeof addr === 'string' && SOLANA_ADDRESS_RE.test(addr);
}

/** Base 주소는 lowercase로 정규화하여 KV 키·비교에 사용한다 (가이드 4.1) */
export function normalizeBaseAddress(addr) {
  return typeof addr === 'string' ? addr.toLowerCase() : addr;
}

/**
 * 체인 식별 규칙 (TASKS 1.2)
 * - `declared`(x-chain)가 있으면 그 값을 우선
 * - 없으면 주소 형식으로 추론: `0x` + 40 hex → `base`, 그 외 Base58 → `solana`
 * - `declared`와 주소 형식이 모순되면 `{ error }` 반환
 */
export function resolveChain({ declared, address }) {
  let chain = declared;
  if (typeof chain === 'string') chain = chain.trim().toLowerCase();
  const validChain = chain === 'solana' || chain === 'base';
  const addr = address || '';

  if (chain === undefined || chain === '') {
    return { chain: isBaseAddress(addr) ? 'base' : 'solana' };
  }

  if (!validChain) {
    return { error: "x-chain must be 'solana' or 'base'" };
  }

  if (addr) {
    let inferred = null;
    if (isBaseAddress(addr)) inferred = 'base';
    else if (isSolanaAddress(addr)) inferred = 'solana';
    if (inferred && inferred !== chain) {
      return {
        error: `x-chain '${chain}' does not match wallet address format (${inferred})`,
      };
    }
  }

  return { chain };
}

// ─── Solana Ed25519 ───────────────────────────────────────────────────────────

/**
 * Solana Ed25519 서명 검증 (기존 동작 유지)
 * 메시지: `x402:{timestamp}` (Base EIP-191과 혼용 금지)
 */
export function verifySolanaSignature(message, signatureBase58, publicKeyBase58) {
  try {
    const messageBytes = textEncoder.encode(message);
    const signatureBytes = bs58.decode(signatureBase58);
    const publicKeyBytes = bs58.decode(publicKeyBase58);

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (e) {
    return false;
  }
}

// ─── EVM 서명 복구 (ecrecover) ────────────────────────────────────────────────

/**
 * 65바이트 (r||s||v) 시그니처로부터 서명자 주소(lowercase)를 복구한다.
 * - `v`가 27/28이면 0/1로 정규화 (TASKS 1.3)
 * - 실패 시 null 반환
 */
function recoverEvmAddress(digest, signatureHex) {
  if (typeof signatureHex !== 'string') return null;

  let hex = signatureHex.trim();
  if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2);
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) return null;

  const sigBytes = new Uint8Array(65);
  for (let i = 0; i < 65; i++) {
    sigBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  let recovery = sigBytes[64];
  if (recovery === 27 || recovery === 28) recovery -= 27;
  if (recovery !== 0 && recovery !== 1) return null;

  try {
    // uncompressed public key (65바이트, 0x04 || x || y)
    const publicKey = secp256k1.recoverPublicKey(digest, sigBytes.slice(0, 64), recovery, false);
    // EVM 주소 = keccak256(pubkey[1:])의 마지막 20바이트
    const addressHash = keccak_256(publicKey.slice(1));
    return '0x' + bytesToHex(addressHash.slice(12));
  } catch (e) {
    return null;
  }
}

// ─── Base EIP-191 ─────────────────────────────────────────────────────────────

/**
 * EIP-191 (`personal_sign`) 검증
 * 메시지: `x402:base:{timestamp}` (체인 바인딩 — Solana 메시지와 분리)
 * 복구: `"\x19Ethereum Signed Message:\n" + len(message) + message` → keccak256 → ecrecover
 */
export function verifyEip191Signature(message, signatureHex, addressLower) {
  try {
    const messageBytes = textEncoder.encode(message);
    const prefix = textEncoder.encode(EIP191_PREFIX);
    const lengthBytes = textEncoder.encode(String(messageBytes.length));

    const digest = keccak_256(concatBytes([prefix, lengthBytes, messageBytes]));
    const recovered = recoverEvmAddress(digest, signatureHex);

    return recovered !== null && recovered === addressLower;
  } catch (e) {
    return false;
  }
}

// ─── Base EIP-712 ─────────────────────────────────────────────────────────────

/**
 * EIP-712 signable 다이제스트
 * `keccak256("\x19\x01" || hashStruct(domain) || hashStruct(message))`
 *
 * domain: `{ name: "AZNP", version: "1", chainId }` (verifyingContract 없음)
 * - viem `getTypesForEIP712Domain` 동작과 바이트 단위로 일치:
 *   도메인 객체에 존재하는 키만 타입 필드로 취급한다.
 * types: `X402Auth { string message, uint256 timestamp }`
 */
export function computeEip712Digest(timestamp, chainId = BASE_CHAIN_ID_DEFAULT) {
  const domainHash = keccak_256(
    concatBytes([
      keccakString(EIP712_DOMAIN_TYPE),
      keccakString(EIP712_DOMAIN_NAME),
      keccakString(EIP712_DOMAIN_VERSION),
      uint256Bytes(chainId),
    ])
  );

  const messageHash = keccak_256(
    concatBytes([
      keccakString(EIP712_MESSAGE_TYPE),
      keccakString('x402'),
      uint256Bytes(timestamp),
    ])
  );

  return keccak_256(concatBytes([new Uint8Array([0x19, 0x01]), domainHash, messageHash]));
}

/**
 * EIP-712 (typed data) 검증
 * - `timestamp`는 헤더 `x-timestamp`와 동일해야 한다 (가이드 4.3)
 * - `addressLower`는 lowercase 정규화된 요청 주소
 */
export function verifyEip712Signature({
  timestamp,
  signatureHex,
  addressLower,
  chainId = BASE_CHAIN_ID_DEFAULT,
}) {
  try {
    const ts = String(timestamp).trim();
    if (!/^\d{1,20}$/.test(ts)) return false;

    const digest = computeEip712Digest(BigInt(ts), Number(chainId));
    const recovered = recoverEvmAddress(digest, signatureHex);

    return recovered !== null && recovered === addressLower;
  } catch (e) {
    return false;
  }
}

// ─── Base USDC 전송 이벤트 ────────────────────────────────────────────────────

/**
 * ERC-20 Transfer(address,address,uint256) topic0 (native USDC 판별용)
 * Base RPC receipt의 `logs[].topics[0]`와 비교한다.
 */
export function transferEventTopic0() {
  return TRANSFER_EVENT_TOPIC0;
}