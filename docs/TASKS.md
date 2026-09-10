# AZNP 작업 체크리스트

이 문서는 `docs/SPEC.md` · `docs/AZNP_Payment_Integration_Guide.md` 기준의 구현 단계입니다.  
작업 착수 전 해당 단계의 항목을 확인하고, 완료 후 체크박스를 `[x]`로 갱신하세요.

> 파일명: 프로젝트 규칙(`AGENTS.md`)에 따라 `docs/TASKS.md` 를 사용합니다.

---

## 0단계: 기반 (완료)

현재 `main` 워커에 이미 반영된 범위입니다. 다음 단계 작업 시 **회귀시키지 마세요**.

- [x] 3-Tier Cascading + Cache API (L1) → KV (L2) 다층 캐시
- [x] Free / Pro 조기 권한 차단 (403) 및 Rate Limit
- [x] Solana Ed25519 무상태 인증 (`x-wallet-address` / `x-signature` / `x-timestamp`)
- [x] Solana USDC `POST /v1/topup` (최소 $20, Pro/Enterprise 크레딧 산식)
- [x] 402 Payment Required + `PAYMENT-REQUIRED` 헤더 (Solana 단일 네트워크)
- [x] Lemon Squeezy / 수동 Pro API Key (`X-API-Key`) 후순위 인증

---

## 1단계: Multi-Chain — Base (EVM) 지갑 서명 & Base USDC 결제

**목표**: 기존 Solana 경로를 유지한 채 Base L2 지갑(EIP-191 / EIP-712) 인증과 Base native USDC 충전을 추가한다.  
**스펙**: `docs/AZNP_Payment_Integration_Guide.md` v2.1 섹션 2, 4, 5, 8  
**제약**: `docs/SPEC.md`에 없는 변환/캐시 동작은 변경하지 않는다. 결제·인증 레이어만 확장한다. 배포(`wrangler deploy`)는 사용자 승인 후에만 수행한다.

### 1.1 환경 변수 및 상수

- [x] `wrangler.toml` `[vars]`에 Base 항목 추가
  - `BASE_CHAIN_ID = "8453"`
  - `BASE_RPC_URL = "https://mainnet.base.org"`
  - `BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"` (Circle native USDC, 6 decimals)
  - `BASE_SERVICE_WALLET_ADDRESS = "0x22E2076148c529981495c3C02A23DfB1D4f8Db9C"` — 수신 EOA. **워커 코드 하드코딩 금지**
- [x] 기존 Solana vars (`SERVICE_WALLET_ADDRESS`, `SOLANA_RPC_URL`, `USDC_MINT_ADDRESS`) 유지
- [x] USDbC (`0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA`) 는 상수로 명시하고 **입금 거부**에 사용
- [x] `README.md` 환경 변수 섹션을 `wrangler.toml`과 동기화 (구현 시점)

### 1.2 요청 규격 · CORS · 체인 식별

- [x] CORS `Access-Control-Allow-Headers`에 `x-chain`, `x-sig-type` 추가 (`src/worker.js`)
- [x] 체인 식별 규칙 구현 (`src/walletAuth.js` `resolveChain` + `src/worker.js` `getPlan`)
  - `x-chain: solana | base` 가 있으면 그 값을 우선
  - 없으면 주소 형식으로 추론: `0x` + 40 hex → `base`, 그 외 Base58 → `solana`
  - `x-chain`과 주소 형식이 모순되면 **400** (`plan: 'chain_mismatch'` 반환)
- [x] `x-sig-type`: `ed25519` | `eip191` | `eip712`
  - Solana 기본값 `ed25519`
  - Base 기본값 `eip191` (미지정 시 EIP-191 검증 후 실패하면 EIP-712 1회 재시도)
- [x] Base 주소는 **lowercase**로 정규화하여 KV 키·비교에 사용 (응답의 `wallet`도 lowercase)

### 1.3 서명 검증 (EIP-191 / EIP-712)

- [x] 인증 헬퍼를 `src/worker.js`에서 분리/모듈화: `src/walletAuth.js`
  - `verifySolanaSignature` 기존 동작 유지 (메시지 `x402:{timestamp}`, Ed25519 + Base58)
  - `verifyEip191Signature(message, signatureHex, address)` 추가
  - `verifyEip712Signature({ timestamp, signatureHex, addressLower, chainId })` 추가
- [x] EIP-191 메시지: **`x402:base:{timestamp}`** (체인 바인딩). Solana 메시지와 섞지 말 것
- [x] EIP-191 복구: `"\x19Ethereum Signed Message:\n" + len + message` → keccak256 → secp256k1 ecrecover
- [x] EIP-712 고정 스키마 (가이드 섹션 4.3과 바이트 단위로 일치, viem `hashTypedData`와 검증)
  - domain: `{ name: "AZNP", version: "1", chainId: 8453 }` (`verifyingContract` 없음)
  - types: `X402Auth { string message, uint256 timestamp }`
  - value: `{ message: "x402", timestamp }` — 헤더 `x-timestamp`와 동일
  - primaryType: `X402Auth`
  - 해시: `keccak256("\x19\x01" || domainSeparator || hashStruct)`
- [x] 타임스탬프 ±300초 창은 체인 공통 (기존 Solana와 동일)
- [x] 서명 65바이트 (`r,s,v`), `v`가 `0/1`이면 `27/28`로 정규화
- [x] 복구 주소 ≠ 요청 주소 → 인증 실패 (Free로 떨어지거나 402, 기존 Solana 실패 경로와 동일)
- [x] 의존성: ethers 미도입. `@noble/hashes` + `@noble/secp256k1` (경량 ecrecover) 추가. `AGENTS.md` 의존성 목록 갱신

### 1.4 `getPlan` 멀티체인 분기

- [x] 인증 우선순위 유지: **지갑 서명 → API Key → Free**
- [x] Base 유효 서명 + 크레딧 > 0 → `plan: 'pro'`, `authType: 'base_wallet'`, `userId` = lowercase 주소
- [x] KV 크레딧 키: `acc:base:{walletLower}:count`
  - Solana는 기존 `acc:{wallet}:count` **변경 금지** (잔액 호환)
- [x] 크레딧 1회 차감 로직은 Solana와 동일 (`count - 1`, 0 이하면 Free)
- [x] `allowed`/`used` 마이그레이션 분기는 Solana 키에만 적용 (Base는 신규이므로 불필요)

### 1.5 `POST /v1/topup` Base 경로

- [x] 요청 바디에 `chain` 추가. 생략 시 EVM 형식(wallet/tx_hash)→`base`, 그 외 **`solana`** (기존 curl/에이전트 하위 호환)
- [x] `chain: "base"` (또는 EVM 형식 wallet/tx_hash로 Base 확정) 시 Base 검증 경로 (`handleBaseTopup`)
- [x] 필수 파라미터 `wallet`, `tx_hash` 유지. Base `tx_hash`는 `0x` + 64 hex
- [x] 중복 처리 키: `tx:base:{tx_hash}` TTL 30일 (Solana `tx:{tx_hash}` 유지)
- [x] Base RPC `eth_getTransactionReceipt` (필요 시 `eth_getTransactionByHash`로 `chainId`/실패 상태 보강)
- [x] receipt `status == 0x1` 이 아니면 400
- [x] 로그에서 native USDC `Transfer`만 채택
  - topic0 = `keccak256("Transfer(address,address,uint256)")` (`transferEventTopic0()`)
  - emitter == `BASE_USDC_ADDRESS`
  - `from` == 요청 wallet, `to` == `BASE_SERVICE_WALLET_ADDRESS`
  - `value / 1e6` = 입금액
- [x] USDbC 또는 다른 ERC-20 Transfer만 있으면 400 (`native USDC Transfer not found`)
- [x] 최소 20 USDC, 티어 산식 기존과 동일 (`>= 100` → ×800, 그 외 ×600)
- [x] 성공 응답에 `chain: "base"` 포함. Solana 성공 응답에도 `chain: "solana"` 추가 (하위 필드 유지)
- [x] `BASE_SERVICE_WALLET_ADDRESS` 미설정 시 Base topup은 **500** (모호한 수신 주소로 크레딧 지급 금지)

### 1.6 402 Payment Required 멀티체인

- [x] `x402PaymentRequiredResponse`를 가이드 섹션 5 JSON 형태로 확장
- [x] 최상위 `service_wallet` / `network: "solana"` **유지** (기존 파서 호환)
- [x] `networks[]`에 `solana` + `base` 객체 추가 (Base `service_wallet`, `usdc`, `chain_id`, 서명 힌트)
- [x] `auth_headers_required`에 `x-chain`, `x-sig-type` 추가
- [x] `PAYMENT-REQUIRED` 응답 헤더에도 `networks` 포함
- [x] 메시지 문구를 체인 중립으로 완화: `"Insufficient credits or missing wallet authentication signature."`

### 1.7 부가 엔드포인트 · 문서 동기화 (구현 범위)

- [x] `GET /health`의 `auth` 필드를 멀티체인 표기로 갱신 (예: `solana-ed25519+base-eip191`)
- [ ] 워커가 `/llms.txt` · `/llms-full.txt` · `/openapi.json` 을 서빙한다면 Base 헤더·topup `chain` 필드 반영 — 워커는 해당 경로를 서빙하지 않음(404, Pages 정적 사이트 담당) → **해당 없음(N/A)**
- [x] `docs/AZNP_Payment_Integration_Guide.md` 섹션 2.1 / 5 / 8의 `BASE_SERVICE_WALLET_ADDRESS`를 `0x22E2076148c529981495c3C02A23DfB1D4f8Db9C`로 교체
- [x] `AGENTS.md` 런타임 의존성 주석: Solana `bs58`/`tweetnacl` + Base ecrecover 라이브러리(`@noble/hashes` + `@noble/secp256k1`)

### 1.8 검증

**자동 테스트 `_auth.test.mjs` (21/21 PASS)**: Solana Ed25519 valid/invalid sig, 체인 식별(형식 추론·모순 400), EIP-191(viem sign/noble v27-28·v0-1/솔라나 메시지 교차 거부), EIP-712(digest=viem 일치, viem sign verify, wrong addr, 복구 주소 일치, replay 거부)

나머지는 `npm run dev` 후 curl로 확인한다 (Base RPC는 목/실트랜잭션 필요). **Solana 회귀를 먼저** 돌린다.

- [x] Solana: 유효 서명 + 크레딧 있는 지갑 → Pro (`X-AZNP-Plan: pro`) — `_auth.test.mjs` 서명 검증 + getPlan 코드 검토
- [x] Solana: `chain` 없는 기존 `POST /v1/topup` 바디가 여전히 동작 — `handleTopup` 하위 호환 로직 유지
- [ ] Base EIP-191: `x402:base:{timestamp}` 서명 → 크레딧 있으면 Pro (curl/런타임 검증 대기)
- [ ] Base EIP-712: 가이드 스키마 서명 → 크레딧 있으면 Pro (curl/런타임 검증 대기)
- [x] Base: 만료 타임스탬프(>300초) → Pro 아님 — getPlan ±300 검증 + 유닛 검증
- [x] Base: 위조 서명 / 주소 불일치 → Pro 아님 — `_auth.test.mjs` (wrong addr, bad sig)
- [x] Base: `x-chain: solana` + `0x` 주소 → 400 — `resolveChain` 모순 검증
- [ ] Base topup: 최소금액 미만 · 중복 tx · USDbC → 400 (curl/실 RPC 대기)
- [ ] Base topup: 유효 native USDC Transfer → 크레딧 적립, 같은 tx 재요청 400 (curl/실 RPC 대기)
- [ ] 402 바디에 `networks` 배열과 기존 `service_wallet`이 모두 존재 (curl 대기)
- [ ] API Key 경로 및 Free 경로가 지갑 헤더 없이도 기존과 동일 (curl 대기)

---

## 2단계 이후

1단계가 모두 `[x]`가 되기 전에는 아래를 착수하지 않는다 (`AGENTS.md` Phase 규칙).

- [ ] `docs/SPEC.md` 섹션 10 로드맵에 Multi-Chain (Base) 항목 반영 여부 — 구현 완료 후 사용자 확인
- [ ] `docs/ARCHITECTURE.md` 부재. 레이아웃 문서가 필요하면 별도 요청으로 작성

---

**문서 끝**
