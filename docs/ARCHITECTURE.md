# AZNP Worker 아키텍처

이 문서는 `AGENTS.md`의 필수 참조 문서 중 하나로, 코드 작성 시 계층(Layer)과 네이밍 컨벤션을 유지하기 위한 설계 기준입니다.

---

## 1. 개요

AZNP(AZNP)는 Cloudflare Workers 단일 워커(`src/worker.js`) 기반의 Markdown / OpenAPI 프록시입니다.
결제는 **온체인 지갑 인증(stateless)** — Solana(Ed25519)와 Base(EVM EIP-191/EIP-712)를 지원하며,
변환 결과는 **Cache API(L1) → KV(L2) → 실제 변환(L3)** 순으로 다층 캐시합니다.

## 2. 요청 처리 흐름 (fetch 파이프라인)

```
클라이언트 요청
   │
   ▼
[1] 라우팅        GET /health · POST /v1/topup · GET /?url=... (그 외 404)
   ▼
[2] 인증/플랜     getPlan(): resolveChain → Solana Ed25519 | Base EIP-191/712 → API Key → Free
   ▼
[3] 조기 차단     Pro 전용 기능 + Free 플랜 → 402 x402 Payment Required (멀티체인 networks 포함)
   ▼
[4] Rate Limit    checkRateLimit (KV sliding window: Free 15/1,000 · Pro 120/20,000)
   ▼
[5] 캐시 (L1→L2)  Cache API → KV 히트 시 즉시 반환 (데이터 옵션 forceFresh 우회)
   ▼
[6] Tier 변환     Tier1(CF Native) → Tier2(자체 변환) → Tier3(Browser Rendering, Pro 전용)
   ▼
[7] 응답          markdown/json + X-AZNP-* 메타 헤더 (추정 토큰·절감률)
```

## 3. 인증 레이어 (결제/인증과 변환 분리)

| 체인 | 검증 | 메시지 | 플랜 키 |
|------|------|--------|--------|
| Solana | Ed25519 + Base58 (`tweetnacl`/`bs58`) | `x402:{timestamp}` | `acc:{wallet}:count` |
| Base | EIP-191 / EIP-712 (`@noble/secp256k1` ecrecover) | `x402:base:{timestamp}` / typed data | `acc:base:{walletLower}:count` |
| API Key | KV `API_KEYS` (`aznp_pro_...`) | — | `keyData.count` |

- 체인 식별 `resolveChain()`: `x-chain` 우선 → 없으면 주소 형식 추론(`0x`40=hex→base, Base58→solana) → 모순 시 `{ error }`.
- 대소문자 규칙: Base 주소는 lowercase로 정규화해 KV 키·비교에 사용.
- 인증 우선순위: **지갑 서명 → API Key → Free**.

## 4. 결제 레이어 (topup)

- `POST /v1/topup`
  - Solana: `getTransaction`의 `post/preTokenBalances` 델타 확인.
  - Base: `eth_getTransactionReceipt`에서 native USDC(emitter==`BASE_USDC_ADDRESS`)의 `Transfer(address,address,uint256)` 로그만 채택. USDbC 등 다른 ERC-20은 `400`.
- 중복 처리: `tx:{tx_hash}`(Solana) / `tx:base:{tx_hash}`(Base), TTL 30일.
- 크레딧: 최소 $20, `>= $100` → ×800(Enterprise), 그 외 ×600(Pro Agent).
- 수신 서비스 지갑은 `SERVICE_WALLET_ADDRESS`, `BASE_SERVICE_WALLET_ADDRESS` 변수로만 관리 (코드 하드코딩 금지).

## 5. 파일/디렉터리 구조

```
├── src/
│   ├── worker.js            # main fetch 핸들러 + topup/getPlan/402 응답
│   ├── walletAuth.js        # 멀티체인 인증·체인 식별·전송 이벤트 상수
│   ├── htmlToMarkdown.js    # Tier 2 HTML→Markdown 변환 + 토큰 추정
│   ├── openapiCompressor.js # OpenAPI 스펙 압축
│   └── rateLimit.js         # KV 슬라이딩 윈도우 rate limit
├── docs/
│   ├── SPEC.md              # 기능 사양·로드맵
│   ├── ARCHITECTURE.md      # (본 문서)
│   └── TASKS.md             # 구현 체크리스트
├── _auth.test.mjs           # 서명/체인 식별 단위 테스트
├── _integration.test.mjs    # mock KV+RPC 통합 테스트 (npm test)
├── wrangler.toml            # 바인딩(KV/D1/BROWSER) 및 vars
└── package.json             # % npm run dev / deploy / test
```

## 6. 바인딩 (계획 규칙)

| 바인딩 | 타입 | 용도 |
|--------|------|------|
| `RESULTS_KV` | KV | L2 변환 결과 캐시 + 충전 크레딧(`acc:*`) |
| `API_KEYS` | KV | Pro API Key 인증 |
| `DB` | D1 | Pro 사용량·토큰 통계 (`ctx.waitUntil()` 비동기 기록) |
| `BROWSER` | Browser Rendering | Tier 3 (Pro 전용) |

## 7. 제약

- `forceFresh` 없이 L1/L2 캐시를 우회하지 않는다.
- 변환/캐시 동작은 `docs/SPEC.md` 범위를 벗어나지 않는다.
- 배포(`wrangler deploy`)는 사용자 승인 후에만 수행.

---

**문서 끝**