# AZNP 결제 및 인증 연동 가이드

**버전**: 2.1  
**작성일**: 2026년 8월 9일  
**개정일**: 2026년 9월 10일  
**핵심 지원**: Multi-Chain Wallet-based Stateless Micro-payment (Solana Ed25519 + Base EIP-191/EIP-712) + Lemon Squeezy (사람용 구독)

---

## 1. 개요

AZNP는 AI 에이전트와 사용자를 위해 세 가지 지불 및 인증 경로를 제공합니다. 온체인 경로는 **회원가입·API Key 없이** 지갑 주소를 계정 ID로 사용합니다.

| 경로 | 대상 | 인증 방식 | 요금 체계 |
|------|------|----------|-----------|
| **A. Solana Wallet Auth** | AI 에이전트 / 개발자 | Solana Ed25519 서명 (`x-wallet-address`) | $20 USDC 이상 충전 크레딧 차감 |
| **B. Base Wallet Auth (EVM)** | AI 에이전트 / 개발자 (EVM 지갑) | EIP-191 `personal_sign` 또는 EIP-712 typed data | $20 USDC 이상 충전 크레딧 차감 (Base USDC) |
| **C. Lemon Squeezy** | 사람 사용자 | API Key (`X-API-Key`) | 월 구독 ($19/mo) |

크레딧은 **체인별로 분리**됩니다. Solana 지갑과 Base 지갑은 각각 독립 계정이며, 한 체인에서 충전한 크레딧을 다른 체인 지갑으로 이전하지 않습니다.

---

## 2. 요금 체계 (USDC, 체인 공통)

AI 에이전트 및 무키(Stateless) 이용자를 위한 충전 단위 및 단가 구조입니다. **Solana USDC와 Base USDC에 동일하게 적용**됩니다.

| 티어 | 최소 충전액 | 부여 크레딧 (요청 횟수) | 건당 단가 | 수수료 비중 (0.7 USDC 출금 기준) | 아끼는 LLM 토큰 가치 |
|------|------------|------------------------|-----------|--------------------------------|----------------------|
| **Pro Agent** | **$20 USDC** | **12,000회** | **$0.00166** (약 2.1원) | **3.5%** | 약 $840 (약 110만원 상당) |
| **Enterprise** | **$100 USDC** | **80,000회** | **$0.00125** (약 1.6원) | **0.7%** (수수료 극소화) | 약 $5,600 (약 730만원 상당) |

- **최소 충전 요건**: **$20 USDC** ($20 미만 입금 시 충전 거부)
- 크레딧 산식: `$100 이상` → `floor(amount × 800)` (Enterprise), `$20 ~ $99.99` → `floor(amount × 600)` (Pro Agent)

### 2.1 네트워크별 수신 정보

| 항목 | Solana | Base (EVM L2) |
|------|--------|----------------|
| Network | `solana` | `base` |
| Chain ID | — | `8453` |
| 수신 서비스 지갑 | `GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E` | `0x22E2076148c529981495c3C02A23DfB1D4f8Db9C` |
| USDC 컨트랙트 / Mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Circle native USDC, 6 decimals) |
| 트랜잭션 해시 형식 | Base58 | `0x` + 64 hex (66자) |
| 지갑 주소 형식 | Base58 PublicKey | `0x` + 40 hex (EIP-55 checksum 권장) |
| RPC | `https://api.mainnet-beta.solana.com` | `https://mainnet.base.org` |

> **주의**: Base에서는 **native USDC만** 인정합니다. 브릿지된 USDbC (`0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA`) 입금은 거부합니다.

---

## 3. Solana Wallet-based Stateless Micro-payment 연동

별도의 회원가입이나 API Key 보관 없이, **솔라나 지갑 주소(PublicKey)** 자체를 계정 ID로 사용합니다.

```
┌──────────────┐                 ┌───────────────────────┐                 ┌────────────────────────┐
│  AI Agent    │ ──(1. Deposit)─>│ Solana Blockchain     │                 │ Cloudflare Workers API │
│ (Wallet/Key) │                 │ (USDC Transfer)       │                 │ + Cloudflare KV        │
└──────────────┘                 └───────────────────────┘                 └────────────────────────┘
       │                                     │                                         │
       │─── (2. POST /v1/topup) ────────────┼────────────────────────────────────────>│
       │    Body: { wallet, tx_hash }        │                                         │
       │    (chain 생략 시 기본값: solana)    │<─── (3. Verify Transaction via RPC) ────│
       │                                     │     Check Receiver, Token, Amount       │
       │                                                                               │
       │─── (4. GET /?url=...) ────────────────────────────────────────────────────────>│
       │    Headers:                                                                   │
       │      x-wallet-address: <SOL_WALLET>                                           │
       │      x-signature: <Ed25519_SIG>                                               │
       │      x-timestamp: <UNIX_TIMESTAMP>                                            │
       │      x-chain: solana          (선택, 주소 형식으로 추론 가능)                    │
       │                                                                               │ (5. Verify Ed25519)
       │                                                                               │ (6. KV INCR/Check)
       │<─── (7. 200 OK / 402 Payment Required) ────────────────────────────────────────│
```

---

### 3.1 충전 API (`POST /v1/topup`)

USDC 송금 후 트랜잭션 해시(`tx_hash`)와 본인의 지갑 주소(`wallet`)를 제출하여 크레딧을 충전합니다.

#### **요청 (Request)**
```bash
curl -X POST "https://aznp-proxy.kerberos79.workers.dev/v1/topup" \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "solana",
    "wallet": "7xKX...AgentSolanaPublicKey",
    "tx_hash": "5K...SolanaTransactionHash"
  }'
```

`chain`을 생략하면 **`solana`** 로 처리합니다 (기존 클라이언트 하위 호환).

#### **성공 응답 (200 OK)**
```json
{
  "success": true,
  "chain": "solana",
  "wallet": "7xKX...AgentSolanaPublicKey",
  "deposited_usdc": 20.0,
  "added_credits": 12000,
  "total_allowed_requests": 12000
}
```

---

### 3.2 서명 인증 요청 (`GET /?url=...`)

에이전트는 API 호출 시 `x402:{timestamp}` 메시지를 본인의 Solana 비밀키로 서명하여 헤더로 전달합니다.

#### **요청 헤더 Specification**
- `x-wallet-address`: Solana Public Key (Base58)
- `x-timestamp`: Unix Timestamp (초 단위, 5분 이내)
- `x-signature`: `x402:{timestamp}` 메시지에 대한 Ed25519 서명 (Base58)
- `x-chain`: `solana` (선택)
- `x-sig-type`: `ed25519` (선택, Solana 기본값)

#### **curl 요청 예시**
```bash
curl -X GET "https://aznp-proxy.kerberos79.workers.dev/?url=https://news.ycombinator.com&render=true" \
  -H "x-wallet-address: 7xKX...AgentSolanaPublicKey" \
  -H "x-timestamp: 1786249000" \
  -H "x-signature: 3mZ...Ed25519SignatureBase58" \
  -H "x-chain: solana"
```

---

## 4. Base (EVM) Wallet-based Stateless Micro-payment 연동

Base L2 지갑(Coinbase Wallet, MetaMask, Rainbow, 에이전트 EOA 등)을 계정 ID로 사용합니다. 서명 표준은 **EIP-191 (`personal_sign`)** 과 **EIP-712 (typed data)** 를 모두 지원합니다.

- 에이전트/스크립트: EIP-191 권장 (메시지 문자열이 Solana와 대칭)
- 사람용 지갑 UI: EIP-712 권장 (지갑에 필드가 구조화되어 표시됨)

```
┌──────────────┐                 ┌───────────────────────┐                 ┌────────────────────────┐
│  AI Agent    │ ──(1. Deposit)─>│ Base L2 (chainId 8453)│                 │ Cloudflare Workers API │
│ (EVM Wallet) │                 │ native USDC Transfer  │                 │ + Cloudflare KV        │
└──────────────┘                 └───────────────────────┘                 └────────────────────────┘
       │                                     │                                         │
       │─── (2. POST /v1/topup) ────────────┼────────────────────────────────────────>│
       │    Body: { chain:"base",            │                                         │
       │            wallet, tx_hash }        │<─── (3. eth_getTransactionReceipt) ─────│
       │                                     │     Transfer event: USDC → service      │
       │                                                                               │
       │─── (4. GET /?url=...) ────────────────────────────────────────────────────────>│
       │    Headers:                                                                   │
       │      x-wallet-address: 0x...                                                  │
       │      x-signature: 0x... (EIP-191 또는 EIP-712)                                 │
       │      x-timestamp: <UNIX_TIMESTAMP>                                            │
       │      x-chain: base                                                            │
       │      x-sig-type: eip191 | eip712                                              │
       │                                                                               │ (5. ecrecover)
       │                                                                               │ (6. KV 크레딧 차감)
       │<─── (7. 200 OK / 402 Payment Required) ────────────────────────────────────────│
```

---

### 4.1 공통 요청 헤더 (Base)

| 헤더 | 필수 | 설명 |
|------|------|------|
| `x-wallet-address` | ✅ | EVM 주소 (`0x` + 40 hex). 검증 시 **소문자 비교**. KV 키도 lowercase로 정규화 |
| `x-timestamp` | ✅ | Unix Timestamp (초). **±300초** 창 (리플레이 방지) |
| `x-signature` | ✅ | `0x` + 130 hex (65바이트 r,s,v). `personal_sign` / `signTypedData` 결과 |
| `x-chain` | 권장 | `base`. `0x` 주소면 Base로 추론 가능하나 명시를 권장 |
| `x-sig-type` | 권장 | `eip191` (기본) 또는 `eip712`. 생략 시 EIP-191 먼저 시도 후 EIP-712 |

Solana 헤더 세트와 동일한 키를 재사용합니다. 체인 구분은 주소 형식(`0x` 여부)과 `x-chain`으로 합니다.

---

### 4.2 EIP-191 (`personal_sign`) — 에이전트 권장

서명 메시지 (체인 바인딩 포함):

```
x402:base:{timestamp}
```

예: timestamp가 `1786249000`이면 원문는 `x402:base:1786249000` 입니다.

서버는 EIP-191 프리픽스를 붙여 복구합니다.

```
"\x19Ethereum Signed Message:\n" + len(message) + message
```

복구된 주소가 `x-wallet-address`와 대소문자 무시 일치해야 합니다.

#### **curl 요청 예시**
```bash
curl -X GET "https://aznp-proxy.kerberos79.workers.dev/?url=https://news.ycombinator.com&render=true" \
  -H "x-wallet-address: 0xAbc...EvmAddress" \
  -H "x-timestamp: 1786249000" \
  -H "x-signature: 0x...65byteSig" \
  -H "x-chain: base" \
  -H "x-sig-type: eip191"
```

> Solana 메시지 `x402:{timestamp}` 와 달리 Base EIP-191은 **`x402:base:{timestamp}`** 입니다. `chainId`가 메시지에 없어 크로스체인 리플레이를 막기 위함입니다.

---

### 4.3 EIP-712 (typed data) — 사람 지갑 권장

오프체인 인증이므로 `verifyingContract`는 사용하지 않습니다. `chainId: 8453`으로 Base에 바인딩합니다.

#### Domain
```json
{
  "name": "AZNP",
  "version": "1",
  "chainId": 8453
}
```

#### Types
```json
{
  "X402Auth": [
    { "name": "message", "type": "string" },
    { "name": "timestamp", "type": "uint256" }
  ]
}
```

#### Message
```json
{
  "message": "x402",
  "timestamp": 1786249000
}
```

#### Primary type
`X402Auth`

서버 복구 해시:

```
keccak256("\x19\x01" || domainSeparator || hashStruct(X402Auth))
```

`x-sig-type: eip712` 로 전달합니다. `x-timestamp` 헤더 값은 typed data의 `timestamp`와 **동일**해야 합니다.

---

### 4.4 Base USDC 충전 API (`POST /v1/topup`)

Base에서 native USDC를 서비스 지갑으로 전송한 뒤, 트랜잭션 해시를 제출합니다.

#### **요청 (Request)**
```bash
curl -X POST "https://aznp-proxy.kerberos79.workers.dev/v1/topup" \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "base",
    "wallet": "0xAbc...EvmAddress",
    "tx_hash": "0x...64hex"
  }'
```

#### 서버 검증 순서

1. `chain === "base"` (또는 `tx_hash`/`wallet`이 `0x` EVM 형식이면 Base 경로)
2. KV `tx:base:{tx_hash}` 중복 여부 (이미 처리된 트랜잭션 거부)
3. Base RPC `eth_getTransactionReceipt` — `status == 0x1` (성공)
4. 로그에서 ERC-20 `Transfer(address,address,uint256)` 이벤트 확인
   - `address` (emitter) == native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - `from` == 요청 `wallet` (lowercase)
   - `to` == `0x22E2076148c529981495c3C02A23DfB1D4f8Db9C` (lowercase 비교)
   - `value` / `1e6` = USDC 금액
5. 최소 **20 USDC** — 미달 시 400
6. USDbC 등 다른 토큰 Transfer는 무시/거부
7. 기존과 동일한 티어 산식으로 크레딧 부여 후 `acc:base:{walletLower}:count` 에 적립

#### **성공 응답 (200 OK)**
```json
{
  "success": true,
  "chain": "base",
  "wallet": "0xabc...evmaddress",
  "deposited_usdc": 20.0,
  "added_credits": 12000,
  "total_allowed_requests": 12000,
  "remaining_count": 12000
}
```

#### 실패 예시

| 상황 | HTTP | 내용 |
|------|------|------|
| `wallet` / `tx_hash` 누락 | 400 | 필수 파라미터 |
| 트랜잭션 실패 또는 미존재 | 400 | receipt 없음 / status != 1 |
| USDC가 아니거나 USDbC | 400 | native USDC Transfer 없음 |
| 수신 지갑 불일치 | 400 | `to` != service wallet |
| 송신 지갑 불일치 | 400 | `from` != 요청 wallet |
| 20 USDC 미만 | 400 | `min_required: 20` |
| 이미 처리된 tx | 400 | `Transaction already processed` |

---

### 4.5 KV 키 규칙 (크레딧)

| 용도 | Solana (기존, 유지) | Base (신규) |
|------|---------------------|-------------|
| 잔여 크레딧 | `acc:{wallet}:count` | `acc:base:{walletLower}:count` |
| 처리된 tx | `tx:{tx_hash}` | `tx:base:{tx_hash}` |

Solana 키 프리픽스를 바꾸지 않아 기존 충전 잔액이 유지됩니다. Base는 체인 프리픽스를 넣어 주소 공간과 트랜잭션 해시를 분리합니다.

---

## 5. 잔액 부족 / 미결제 응답 (`402 Payment Required`)

크레딧이 부족하거나 유효한 지갑 서명이 없을 때 402와 `PAYMENT-REQUIRED` 헤더를 반환합니다. **두 체인 모두 안내**하며, 기존 Solana 클라이언트용 최상위 필드(`service_wallet`, `network`)는 유지합니다.

```json
{
  "error": "Payment Required",
  "message": "Insufficient credits or missing wallet authentication signature.",
  "currency": "USDC",
  "min_deposit": "$20 USDC",
  "tiers": {
    "Pro Agent": "$20 USDC = 12,000 requests ($0.00166/req)",
    "Enterprise": "$100 USDC = 80,000 requests ($0.00125/req)"
  },
  "topup_endpoint": "POST /v1/topup",
  "network": "solana",
  "service_wallet": "GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E",
  "networks": [
    {
      "network": "solana",
      "currency": "USDC",
      "service_wallet": "GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E",
      "usdc": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "auth": "ed25519",
      "message": "x402:{timestamp}"
    },
    {
      "network": "base",
      "chain_id": 8453,
      "currency": "USDC",
      "service_wallet": "0x22E2076148c529981495c3C02A23DfB1D4f8Db9C",
      "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "auth": ["eip191", "eip712"],
      "eip191_message": "x402:base:{timestamp}",
      "eip712": {
        "domain": { "name": "AZNP", "version": "1", "chainId": 8453 },
        "primaryType": "X402Auth"
      }
    }
  ],
  "auth_headers_required": {
    "x-wallet-address": "<SOLANA_PUBLIC_KEY | 0x_EVM_ADDRESS>",
    "x-signature": "<Ed25519_BASE58 | 0x_EVM_SIG>",
    "x-timestamp": "<UNIX_TIMESTAMP>",
    "x-chain": "solana | base",
    "x-sig-type": "ed25519 | eip191 | eip712"
  }
}
```

`PAYMENT-REQUIRED` 헤더에도 `networks` 배열을 포함합니다.

---

## 6. AI 에이전트 구현 예시

### 6.1 Solana (Node.js, 기존)

```javascript
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const AGENT_PRIVATE_KEY_BASE58 = "YOUR_AGENT_PRIVATE_KEY_BASE58";
const secretKey = bs58.decode(AGENT_PRIVATE_KEY_BASE58);
const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
const publicKeyBase58 = bs58.encode(keypair.publicKey);

async function callAZNPProxy(targetUrl) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `x402:${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);

  const signatureBytes = nacl.sign.detached(messageBytes, keypair.secretKey);
  const signatureBase58 = bs58.encode(signatureBytes);

  const res = await fetch(`https://aznp-proxy.kerberos79.workers.dev/?url=${encodeURIComponent(targetUrl)}&render=true`, {
    headers: {
      'x-wallet-address': publicKeyBase58,
      'x-signature': signatureBase58,
      'x-timestamp': timestamp,
      'x-chain': 'solana',
    }
  });

  if (res.status === 402) {
    const errorData = await res.json();
    console.error("잔액 부족! 충전 필요. Solana 수신 지갑:", errorData.service_wallet);
    // 에이전트가 20 USDC 전송 후 POST /v1/topup { chain: "solana", wallet, tx_hash }
  } else {
    const markdown = await res.text();
    console.log("변환 성공 Clean Markdown:", markdown.slice(0, 200));
  }
}
```

### 6.2 Base EIP-191 (Node.js, viem)

```javascript
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount('0xYOUR_AGENT_PRIVATE_KEY');

async function callAZNPProxyBase(targetUrl) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `x402:base:${timestamp}`;
  const signature = await account.signMessage({ message });

  const res = await fetch(
    `https://aznp-proxy.kerberos79.workers.dev/?url=${encodeURIComponent(targetUrl)}&render=true`,
    {
      headers: {
        'x-wallet-address': account.address,
        'x-timestamp': timestamp,
        'x-signature': signature,
        'x-chain': 'base',
        'x-sig-type': 'eip191',
      },
    }
  );

  if (res.status === 402) {
    const errorData = await res.json();
    const baseNet = errorData.networks.find((n) => n.network === 'base');
    console.error('잔액 부족! Base 수신 지갑:', baseNet.service_wallet);
    console.error('USDC (native):', baseNet.usdc);
    // Base에서 native USDC 20 전송 후 POST /v1/topup { chain: "base", wallet, tx_hash }
  } else {
    const markdown = await res.text();
    console.log('변환 성공 Clean Markdown:', markdown.slice(0, 200));
  }
}
```

### 6.3 Base EIP-712 (Node.js, viem)

```javascript
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount('0xYOUR_AGENT_PRIVATE_KEY');

const domain = { name: 'AZNP', version: '1', chainId: 8453 };
const types = {
  X402Auth: [
    { name: 'message', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

async function callAZNPProxyBase712(targetUrl) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: 'X402Auth',
    message: { message: 'x402', timestamp: BigInt(timestamp) },
  });

  const res = await fetch(
    `https://aznp-proxy.kerberos79.workers.dev/?url=${encodeURIComponent(targetUrl)}&render=true`,
    {
      headers: {
        'x-wallet-address': account.address,
        'x-timestamp': String(timestamp),
        'x-signature': signature,
        'x-chain': 'base',
        'x-sig-type': 'eip712',
      },
    }
  );

  return res;
}
```

### 6.4 Base 충전 후 크레딧 반영

```bash
# 1) Base native USDC를 서비스 지갑으로 전송 (지갑/에이전트)
# 2) 트랜잭션 해시로 충전
curl -X POST "https://aznp-proxy.kerberos79.workers.dev/v1/topup" \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "base",
    "wallet": "0xAbc...EvmAddress",
    "tx_hash": "0xdead...beef"
  }'
```

---

## 7. Lemon Squeezy 연동 (사람 사용자용)

사람 사용자의 경우 기존 문서를 참고하여 홈페이지에서 $19/월 결제 후 `X-API-Key`를 발급받아 사용할 수 있습니다. 온체인 멀티체인 경로와 병행되며, API Key 인증이 지갑 서명보다 **후순위**입니다.

인증 우선순위:

1. 지갑 서명 (`x-wallet-address` + `x-signature` + `x-timestamp`) — Solana 또는 Base
2. `X-API-Key` (Lemon Squeezy / 수동 발급 Pro 키)
3. 인증 없음 → Free 플랜

---

## 8. 환경 변수 (`wrangler.toml`)

```toml
[vars]
# Solana
SERVICE_WALLET_ADDRESS = "GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E"
SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com"
USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

# Base (EVM L2)
BASE_CHAIN_ID = "8453"
BASE_RPC_URL = "https://mainnet.base.org"
BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
BASE_SERVICE_WALLET_ADDRESS = "0x22E2076148c529981495c3C02A23DfB1D4f8Db9C"

X402_PRICE_USDC = "0.00166"
```

수신 EOA는 `wrangler.toml`의 `BASE_SERVICE_WALLET_ADDRESS`로만 관리하고, 워커 코드에 하드코딩하지 않습니다.

---

**문서 끝**
