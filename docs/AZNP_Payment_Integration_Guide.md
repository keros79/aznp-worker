# AZNP 결제 및 인증 연동 가이드

**버전**: 2.0  
**작성일**: 2026년 8월 9일  
**핵심 지원**: Solana Wallet-based Stateless Micro-payment (API Key / 회원가입 필요 없음) + Lemon Squeezy (사람용 구독)

---

## 1. 개요

AZNP는 AI 에이전트와 사용자를 위해 두 가지 지불 및 인증 경로를 제공합니다.

| 경로 | 대상 | 인증 방식 | 요금 체계 |
|------|------|----------|-----------|
| **A. Solana Wallet Auth (권장)** | AI 에이전트 / 개발자 | Solana Ed25519 서명 (`x-wallet-address`) | $20 USDC 이상 충전 크레딧 차감 |
| **B. Lemon Squeezy** | 사람 사용자 | API Key (`X-API-Key`) | 월 구독 ($19/mo) |

---

## 2. 요금 체계 (Solana USDC)

AI 에이전트 및 무키(Stateless) 이용자를 위한 충전 단위 및 단가 구조입니다.

| 티어 | 최소 충전액 | 부여 크레딧 (요청 횟수) | 건당 단가 | 수수료 비중 (0.7 USDC 출금 기준) | 아끼는 LLM 토큰 가치 |
|------|------------|------------------------|-----------|--------------------------------|----------------------|
| **Pro Agent** | **$20 USDC** | **12,000회** | **$0.00166** (약 2.1원) | **3.5%** | 약 $840 (약 110만원 상당) |
| **Enterprise** | **$100 USDC** | **80,000회** | **$0.00125** (약 1.6원) | **0.7%** (수수료 극소화) | 약 $5,600 (약 730만원 상당) |

- **최소 충전 요건**: **$20 USDC** ($20 미만 입금 시 충전 거부)
- **수신 서비스 지갑 주소 (Solana)**: `GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E`
- **USDC Mint Address**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

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
       │                                     │<─── (3. Verify Transaction via RPC) ────│
       │                                     │     Check Receiver, Token, Amount       │
       │                                                                               │
       │─── (4. GET /?url=...) ────────────────────────────────────────────────────────>│
       │    Headers:                                                                   │
       │      x-wallet-address: <SOL_WALLET>                                           │
       │      x-signature: <Ed25519_SIG>                                               │
       │      x-timestamp: <UNIX_TIMESTAMP>                                            │
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
    "wallet": "7xKX...AgentSolanaPublicKey",
    "tx_hash": "5K...SolanaTransactionHash"
  }'
```

#### **성공 응답 (200 OK)**
```json
{
  "success": true,
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

#### **curl 요청 예시**
```bash
curl -X GET "https://aznp-proxy.kerberos79.workers.dev/?url=https://news.ycombinator.com&render=true" \
  -H "x-wallet-address: 7xKX...AgentSolanaPublicKey" \
  -H "x-timestamp: 1786249000" \
  -H "x-signature: 3mZ...Ed25519SignatureBase58"
```

---

### 3.3 잔액 부족 / 미결제 응답 (`402 Payment Required`)

크레딧이 부족하거나 서명 인증이 없을 때 402 응답과 `PAYMENT-REQUIRED` 헤더를 반환합니다.

```json
{
  "error": "Payment Required",
  "message": "Insufficient credits or missing Solana Wallet authentication signature.",
  "service_wallet": "GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E",
  "network": "solana",
  "currency": "USDC",
  "min_deposit": "$20 USDC",
  "tiers": {
    "Pro Agent": "$20 USDC = 12,000 requests ($0.00166/req)",
    "Enterprise": "$100 USDC = 80,000 requests ($0.00125/req)"
  },
  "topup_endpoint": "POST /v1/topup"
}
```

---

## 4. AI 에이전트 구현 예시 (Node.js)

```javascript
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const AGENT_PRIVATE_KEY_BASE58 = "YOUR_AGENT_PRIVATE_KEY_BASE58";
const secretKey = bs58.decode(AGENT_PRIVATE_KEY_BASE58);
// nacl keypair from secret key (64 bytes)
const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
const publicKeyBase58 = bs58.encode(keypair.publicKey);

async function callAZNPProxy(targetUrl) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `x402:${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);

  // 메시지 Ed25519 서명
  const signatureBytes = nacl.sign.detached(messageBytes, keypair.secretKey);
  const signatureBase58 = bs58.encode(signatureBytes);

  const res = await fetch(`https://aznp-proxy.kerberos79.workers.dev/?url=${encodeURIComponent(targetUrl)}&render=true`, {
    headers: {
      'x-wallet-address': publicKeyBase58,
      'x-signature': signatureBase58,
      'x-timestamp': timestamp,
    }
  });

  if (res.status === 402) {
    const errorData = await res.json();
    console.error("잔액 부족! 충전 필요. 수신 지갑:", errorData.service_wallet);
    // 에이전트가 20 USDC 전송 후 /v1/topup 호출
  } else {
    const markdown = await res.text();
    console.log("변환 성공 Clean Markdown:", markdown.slice(0, 200));
  }
}
```

---

## 5. Lemon Squeezy 연동 (사람 사용자용)

사람 사용자의 경우 기존 문서를 참고하여 홈페이지에서 $19/월 결제 후 `X-API-Key`를 발급받아 사용할 수 있습니다.

---

**문서 끝**