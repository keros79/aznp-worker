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
  - `x-chain` 미전달(`null`)/빈 문자열은 "선언 없음"으로 취급 (지갑 없는 API Key/Free 경로가 깨지면 안 됨)
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

- [x] 요청 바디에 `chain` 추가. 생략 시 EVM 형식(wallet/tx_hash)→`base`, 그 외 **`solana`** (기존 하위 호환)
- [x] `chain: "base"` (또는 EVM 형식 wallet/tx_hash로 Base 확정) 시 Base 경로 (`handleBaseTopup`)
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

### 1.7 부가 엔드포인트 · 문서 동기화

- [x] `GET /health`의 `auth` 필드를 멀티체인 표기로 갱신 (`solana-ed25519+base-eip191`)
- [x] `/llms.txt`·`/llms-full.txt`·`/openapi.json` — 워커가 서빙하지 않는 경로(404)라 반영 대상 없음(**N/A**)
- [x] `docs/AZNP_Payment_Integration_Guide.md` 섹션 2.1 / 5 / 8의 `BASE_SERVICE_WALLET_ADDRESS` 반영
- [x] `AGENTS.md` 런타임 의존성 주석: Solana `bs58`/`tweetnacl` + Base `@noble/hashes`/`@noble/secp256k1`
- [x] `docs/ARCHITECTURE.md` 신규 작성 (이전 부재 — AGENTS.md 필수 참조 문서)

### 1.8 검증

**자동 테스트 2종 — `npm test` (총 59/59 PASS)**:

- `_auth.test.mjs` (21/21) — 서명·체인 식별 단위 검증
- `_integration.test.mjs` (38/38) — mock KV + mock RPC(global fetch 패치, 실네트워크 무호출)로 워커 함수 직접 검증

- [x] Solana: 유효 서명 + 크레딧 있는 지갑 → Pro (ed25519 + `acc:{wallet}:count` 차감 7→6)
- [x] Solana: `chain` 없는 기존 `POST /v1/topup` 바디가 여전히 동작 (chain 미지정 + base58 → solana, 200)
- [x] Base EIP-191: `x402:base:{timestamp}` 서명 → 크레딧 있으면 Pro (pro + 차감 5→4)
- [x] Base EIP-712: 가이드 스키마 서명 → 크레딧 있으면 Pro (pro + 차감 3→2)
- [x] Base: `x-sig-type` 미지정 → EIP-191 우선, 실패 시 EIP-712 재시도
- [x] Base: 만료 타임스탬프(>300초) → Pro 아님
- [x] Base: 위조 서명 / 주소 불일치 → Pro 아님
- [x] Base: `x-chain: solana` + `0x` 주소 → 400 (chain_mismatch)
- [x] Base topup: 최소금액 미달(10 USDC) → 400
- [x] Base topup: 중복 tx → 400
- [x] Base topup: USDbC 등 다른 emitter → 400 (`native USDC Transfer not found`)
- [x] Base topup: 수신자 불일치 → 400
- [x] Base topup: receipt status=0x0 → 400
- [x] Base topup: 유효 native USDC Transfer → 크레딧 적립, 같은 tx 재요청 400
- [x] 402 바디에 `networks` 배열과 기존 `service_wallet`이 모두 존재
- [x] API Key 경로 및 Free 경로가 지갑 헤더 없이도 기존과 동일
- [x] **회귀 버그 수정**: `resolveChain`이 `x-chain` 헤더 미전달(`null`) 시 잘못 에러를 던지던 문제 수정 (지갑 없는 API Key/Free 요청이 `chain_mismatch`로 깨지던 사례) — `_auth` null 선언 회귀 테스트 추가

---

## 2단계: AI Agent 응답 포맷 · 컨텍스트 제한 · LLM 에러

**목표**: 변환 응답을 AI 에이전트가 바로 소비할 수 있게 포맷·길이·에러를 맞춘다. 결제/인증 레이어는 변경하지 않는다.
**스펙**: `docs/SPEC.md` 섹션 5 (쿼리 파라미터·응답 헤더·에러)를 본 단계에서 확장. 구현과 함께 SPEC·ARCHITECTURE를 동기화한다.
**제약**:
- 외부 YAML/TOML/JSON-LD 라이브러리 추가 금지. 고정 스키마 자체 직렬화만 사용한다 (`AGENTS.md` 4.2).
- 다층 캐시 순서(L1 Cache API → L2 KV → L3 변환)를 유지한다. `format`·`max_tokens`는 캐시 키에 포함한다.
- 402 Payment Required 바디/`PAYMENT-REQUIRED` 헤더, `POST /v1/topup` JSON은 **유지** (x402·지갑 클라이언트 파서 호환).
- 기존 `format=json`(Pro) · `format=markdown`(기본, Free/Pro) 하위 호환.
- 배포(`wrangler deploy`)는 사용자 승인 후에만 수행한다.

### 2.0 검토 결과 (범위)

| 제안 | 결과 | 이유 |
|------|------|------|
| 포맷 다변화 (`markdown` / `toml` / `yaml` / `json-ld`) | **포함** | 기존 `format` 파라미터·`allowStructured`·캐시 키 구조와 맞음. 고정 스키마 직렬화로 의존성 없이 가능 |
| `max_tokens` 중요도 기반 압축 | **포함** | 파라미터·Pro 게이트는 이미 있음. 현재는 `chars*4` 단순 slice라 헤더/문장 중간이 잘림. 마크다운 블록 스코어링으로 교체 가능 |
| 토큰 절감 HTTP 헤더 (`X-AZNP-Original-Tokens` 등) | **제외** | 아래 2.0.1 |
| LLM-readable 에러 (TOML/텍스트) | **포함** | Worker가 만드는 4xx/5xx는 이미 JSON. HTML이 아님. 스키마에 `action_recommendation`을 넣고 TOML/텍스트로 바꾸면 에이전트 재시도 루프를 줄일 수 있음 |

#### 2.0.1 제외: 토큰 절감 분석 헤더 (신규)

이미 변환 응답에 추정 헤더가 있다: `X-Markdown-Tokens`, `X-Original-Tokens`, `X-Token-Reduction` (`estimateTokens` = `ceil(len/4)`, 원본은 HTML 태그 제거 후 동일 추정).

정확한 “절약 토큰 / 절약률”은 모델별 토크나이저(tiktoken, Claude 등)에 의존하고, Workers에 토크나이저를 넣는 비용 대비 값이 낮다. 추정 절감률을 새 이름(`X-AZNP-Tokens-Saved`)으로 바꿔도 정보가 늘지 않는다.

- [x] **신규 헤더를 추가하지 않는다.** 기존 세 헤더는 유지한다 (이름 변경·삭제 금지).

### 2.1 포맷 다변화 (`?format=`)

현재: `format` 기본값 `markdown`, `json`만 Pro 구조화 출력.

- [x] 허용 값: `markdown` (기본) · `toml` · `yaml` · `json-ld` · `json`(기존)
  - 그 외 값 → 400 LLM-readable 에러 (`code=unsupported_format`, action: 허용 값 안내)
- [x] 플랜: `markdown` = Free/Pro. `toml` / `yaml` / `json-ld` / `json` = Pro (`allowStructured`). Free가 구조화 포맷을 요청하면 기존과 같이 **402** (json과 동일 게이트)
- [x] `Content-Type`
  - `markdown` → `text/markdown; charset=utf-8`
  - `toml` → `application/toml; charset=utf-8`
  - `yaml` → `application/yaml; charset=utf-8`
  - `json-ld` / `json` → `application/ld+json; charset=utf-8` / `application/json; charset=utf-8`
- [x] 직렬화는 변환된 마크다운을 **후처리**한다 (Tier 변환기 자체는 마크다운 유지)
- [x] 모듈: `src/formatters.js` (worker.js에 인라인 금지). 이스케이프만 자체 구현 (YAML `|` 블록, TOML `"""`, JSON-LD는 `JSON.stringify`)
- [x] **TOML** — 메타·Key-Value 중심. 긴 본문은 멀티라인 문자열. 예시 스키마:
  ```toml
  title = "..."
  source = "https://..."
  tokens = 1800

  [meta]
  plan = "pro"
  extraction = "aznp-self"

  content = """
  ...markdown...
  """
  ```
- [x] **YAML** — 헤딩 계층을 중첩 맵으로 파싱 (H1→H2→본문). 헤딩이 거의 없으면 TOML과 같은 flat `title` / `source` / `content`
- [x] **JSON-LD** — Schema.org `Article` (`@context`, `@type`, `headline`, `url`, `articleBody`). 기존 `format=json`의 `{ title, source, content, meta }`는 변경하지 않음
- [x] OpenAPI 압축 응답은 이번 단계에서 JSON 유지 (`format` 미적용). 파일 Bypass 307도 포맷 변환 대상 아님

### 2.2 `max_tokens` 중요도 기반 압축

현재: Pro 전용, `approxChars = maxTokens * 4` 후 `markdown.slice(...)`. 캐시 키에 `max_tokens` **미포함**.

- [x] 토큰 추정은 기존 `estimateTokens` (`ceil(len/4)`)를 그대로 쓴다. tiktoken 등 미도입
- [x] 한도 대상은 **최종 응답 본문** (`estimateTokens(body) <= max_tokens`). 포맷 래퍼(YAML/TOML 키) 오버헤드를 포함
- [x] 단순 `slice` 제거. 마크다운을 블록(heading / paragraph / list / code / quote)으로 나눈 뒤 점수:
  1. H1, Source 라인, description quote — 항상 유지
  2. H2 > H3–H6
  3. 각 섹션 첫 단락 > 이후 단락 (뒤에 올수록 감점)
  4. 리스트·코드는 중간
- [x] 점수 순으로 담되 **출력 순서는 원문 순서**. 한도를 넘으면 최저점 블록부터 제외. 마지막 포함 블록만 문장 경계에서 잘라 맞춤
- [x] 잘렸을 때만 끝에 한 줄: `*(truncated to {max_tokens} tokens)*` (해당 포맷에 맞게)
- [x] `max_tokens <= 0` 또는 미지정 → 기존처럼 무제한. 잘못된 값(NaN, 음수, 비숫자) → 0으로 취급
- [x] 상한: 예 `max_tokens > 100000` → 400 (`code=max_tokens_too_large`)
- [x] Pro 게이트 유지 (`maxTokens > 0` → `requiresPro`). `limits.allowSummary`에 묶지 말고 `max_tokens` 전용 조건으로 분리 (요약과 길이 제한은 다른 기능)
- [x] **캐시 키**: L1 `canonicalParams`와 L2 `kvKey`에 `max_tokens`를 넣는다 (`> 0`일 때만). 넣지 않으면 서로 다른 한도가 같은 캐시를 친다
- [x] 모듈: `src/truncateMarkdown.js` (또는 `htmlToMarkdown.js` export). 변환 파이프라인은 “마크다운 생성 → truncate → format” 순서

### 2.3 AI 친화 에러 응답 (LLM-Readable Errors)

현재: Worker 에러는 JSON `{ error }`. Cloudflare 플랫폼 HTML(1101 등)은 Worker 밖에서 나와 **이번 범위 밖**.

- [x] 변환 API (`GET /`, `GET /health` 제외한 4xx/5xx) 에러 헬퍼를 `jsonResponse`에서 분리: `errorResponse({ status, code, message, action_recommendation, format })`
- [x] 기본 본문: TOML `[error]` 테이블. `format=json` 또는 `Accept: application/json`이면 JSON, `format=yaml`이면 YAML. `format=markdown`/`toml`/미지정 → TOML
- [x] 고정 필드: `status` (HTTP) · `code` (snake_case) · `message` · `action_recommendation`
  ```toml
  [error]
  status = 404
  code = "not_found"
  message = "Unknown path. Use GET /?url=<target_url> or POST /v1/topup"
  action_recommendation = "Retry with GET /?url=https://example.com or read docs"
  ```
- [x] 기존 변환 경로 에러를 매핑 (메시지 의미 유지, recommendation 추가):
  | HTTP | code | 예 |
  |------|------|----|
  | 400 | `missing_url` / `invalid_url` / `unsupported_format` / `max_tokens_too_large` / `chain_mismatch` | 파라미터 교정 |
  | 403 | `private_url` | 공개 http(s) URL 사용 |
  | 404 | `not_found` | `GET /?url=` 또는 `POST /v1/topup` |
  | 405 | `method_not_allowed` | GET 사용 |
  | 429 | `rate_limited` | `Retry-After` 초만큼 대기 (헤더 유지) |
  | 502 | `fetch_failed` | URL·접근성 확인 후 재시도 |
  | 500 | `internal_error` | 재시도 횟수 제한, 반복 실패 시 중단 |
- [x] **건드리지 않음**: 402 JSON + `PAYMENT-REQUIRED`, `POST /v1/topup` JSON, `/health` JSON 200
- [x] robots.txt 차단은 구현하지 않는다 (현재 타깃 robots 미검사). 예시 문구의 `blocked by robots.txt`를 새 에러로 만들지 말 것
- [x] Cloudflare 플랫폼 HTML 에러는 문서에 “범위 밖”으로만 적는다

### 2.4 캐시 · CORS · 권한

- [x] L1/L2 키: `url` + `mode` + `format` + `images` + `plan` + (`max_tokens` if > 0)
- [x] KV에는 **마크다운(truncate 후)** 을 저장하고, 히트 시 `format`으로 직렬화해도 된다. 그 경우 키에 `max_tokens`는 넣고 `format`은 빼도 됨 — 한 가지를 골라 ARCHITECTURE에 명시. 혼용 금지
- [x] `requiresPro`에 `toml` / `yaml` / `json-ld` 포함 (`json`·`max_tokens`·`summary`·`render`와 동일하게 조기 402)
- [x] CORS `Access-Control-Expose-Headers`는 기존 `X-AZNP-*` / `X-Markdown-Tokens` / `X-Original-Tokens` / `X-Token-Reduction` 유지 (신규 토큰 헤더 없음)

### 2.5 문서 동기화

- [x] `docs/SPEC.md` 섹션 5.2 `format` 값·플랜, 5.4 헤더(기존 유지 명시), 5.5 에러를 TOML 기본으로 갱신. 섹션 10 로드맵에 v2.7 (또는 다음 빈 버전) 행 추가
- [x] `docs/ARCHITECTURE.md` 파이프라인 [7] 응답: markdown/json/toml/yaml/json-ld + truncate 후처리. 파일 목록에 `formatters.js` (및 truncate 모듈)
- [x] `README.md` 쿼리 파라미터·에러 예시 동기화

### 2.6 검증

`_integration.test.mjs` (또는 동등 단위 테스트)에 실네트워크 없이 추가. `npm test`가 기존 1단계 케이스를 포함해 통과해야 한다.

- [x] 기본 `GET /?url=` → `Content-Type: text/markdown`, 본문이 마크다운
- [x] `format=toml` (Pro) → TOML 파싱 가능, `title`/`source`/`content` 존재
- [x] `format=yaml` (Pro) → 헤딩 있는 픽스처에서 중첩 키 존재
- [x] `format=json-ld` (Pro) → `@context` / `@type` = Article
- [x] `format=json` (Pro) → 기존 `{ title, source, content, meta }` 유지
- [x] `format=xml` 등 미지원 → 400 + `unsupported_format`
- [x] Free + `format=toml|yaml|json-ld|json` → 402 (JSON 유지)
- [x] `max_tokens=2000` (Pro): 긴 픽스처에서 `estimateTokens(body) <= 2000`, H1이 잘리지 않음, 본문 중간 `slice`가 아님
- [x] 동일 URL에 `max_tokens=500` vs `2000` → 캐시 키가 달라 서로 다른 본문
- [x] `max_tokens` 없이 요청 → 기존 전체 본문 (회귀)
- [x] 없는 경로 404 → TOML `[error]` + `action_recommendation` (JSON 아님)
- [x] `format=json` 요청의 400/404 → JSON 에러
- [x] 402 · `POST /v1/topup` 에러 → JSON 유지
- [x] 기존 Solana/Base 인증·topup·402 `networks` 테스트 회귀 없음

---

## 3단계 이후

2단계가 모두 `[x]`가 되기 전에는 아래를 착수하지 않는다.

- [ ] Browser Rendering 완전 연동 (`docs/SPEC.md` v2.3)
- [ ] Workers AI 요약 + 캐시 (`docs/SPEC.md` v2.4)
- [ ] 도메인별 프리셋 규칙 KV (`docs/SPEC.md` v2.5)
- [ ] Pages 대시보드 (`docs/SPEC.md` v2.6)

---

**문서 끝**