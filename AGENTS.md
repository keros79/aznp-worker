# 프로젝트 AI 에이전트 작업 지침 (AGENTS.md)

이 문서는 프로젝트 내 작업을 수행하는 모든 AI 코딩 에이전트를 위한 핵심 규칙과 참조 안내서입니다.
작업을 시작하기 전, 아래에 지정된 문서들을 순서대로 확인하고 해당 가이드라인을 엄격히 준수하세요.

---

## 1. 프로젝트 핵심 문서 참조 (Mandatory Context)

모든 작업은 아래 `docs/` 디렉터리의 문서 기준에 맞춰 수행해야 합니다.

1. **`docs/SPEC.md`**: 기능 사양 및 프로젝트 목표
   - 프로젝트의 비전, 핵심 요구사항, 유저 스토리 및 비기능적 요구사항이 정의되어 있습니다.
   - 새로운 기능을 구현하거나 기존 기능을 변경할 때 목표에 부합하는지 반드시 확인하세요.

2. **`docs/ARCHITECTURE.md`**: 파일/디렉터리 구조 및 클래스 설계
   - 시스템 아키텍처, 디렉터리 레이아웃, 모듈 간 의존성, 클래스 및 데이터 모델 구조가 정의되어 있습니다.
   - 코드 작성 시 정의된 계층(Layer)과 네이밍 컨벤션을 이탈하지 마세요.

3. **`docs/TASKS.md`**: 구현할 세부 작업 체크리스트 (1단계 ~ N단계)
   - 작업의 순서 및 마일스톤별 세부 체크리스트입니다.
   - 작업 착수 시 현재 진행 중인 단계의 작업 항목을 확인하고, 완료 후 체크리스트 상태를 업데이트하세요.

---

## 2. 에이전트 행동 지침 및 작업 흐름 (Workflow Rules)

### Phase 1: 작업 시작 전 (Context Awareness)
- **문서 동기화**: 요청받은 기능이 `docs/SPEC.md`의 목표와 맞는지, `docs/TASKS.md` 상에서 어떤 단계에 위치해 있는지 파악합니다.
- **설계 확인**: `docs/ARCHITECTURE.md`를 읽고 작성할 코드의 파일 위치, 인터페이스, 클래스 구조를 구상합니다.

### Phase 2: 코드 작성 및 수정 (Implementation)
- **일관성 유지**: 기존 파일 구조와 스타일 가이드를 준수합니다.
- **점진적 구현**: 한 번에 과도하게 많은 파일을 변경하지 말고 `docs/TASKS.md`에 명시된 단위별로 분할하여 구현합니다.
- **사이드 이펙트 방지**: 기존 아키텍처 규칙을 위배하는 임의의 모듈이나 외부 라이브러리를 무단으로 추가하지 마세요.

### Phase 3: 검증 및 문서 업데이트 (Verification & Handover)
- **테스트 및 검증**: 작성한 코드에 대해 빌드 및 테스트(유닛/통합 테스트)를 실행하여 동작을 확인합니다.
- **상태 업데이트**: 작업이 완료되면 `docs/TASKS.md` 해당 항목의 체크박스를 `[x]`로 갱신합니다.
- **변경 사항 요약**: 작업 완료 후 수정한 파일 목록과 `docs/SPEC.md` / `docs/ARCHITECTURE.md` 대비 달성한 내용을 사용자에게 명확히 보고합니다.

---

## 3. 기술 스택 및 주요 명령 (Commands & Environment)

- **플랫폼/Runtime**: Cloudflare Workers (Wrangler v3) / Node.js >= 18 (로컬 v22)
- **Language**: JavaScript (ESM, `"type": "module"`) — 진입점 `src/worker.js`
- **Package Manager**: npm (`package-lock.json`)
- **주요 의존성**:
  - 런타임 (Solana): `bs58`, `tweetnacl` (Ed25519 서명 검증 / Base58 인코딩)
  - 런타임 (Base EVM): `@noble/hashes` (keccak256), `@noble/secp256k1` (경량 ecrecover, CF Workers 호환)
  - 개발: `wrangler` (로컬 개발·배포)
- **Cloudflare 인프라 바인딩**: `RESULTS_KV`, `API_KEYS` (KV), `DB` (D1), `BROWSER` (Browser Rendering) → `wrangler.toml` 참조
- **주요 실행 명령**:
  - 패키지 설치: `npm install`
  - 로컬 개발 서버: `npm run dev` (wrangler dev, 포트 8787)
  - 배포(프로덕션): `npm run deploy` (wrangler deploy)
  - 로그 확인: `npm run tail`
  - KV 네임스페이스 관리: `npm run kv:list` / `kv:create:results` / `kv:create:apikeys`
  - 테스트: `npm test` — `node _auth.test.mjs && node _integration.test.mjs` 자동 실행 (서명/체인/포맷/에러/발견 엔드포인트). 실네트워크 없이 mock KV+RPC 사용
  - 린트/타입 체크/빌드 스크립트: 없음 (Vanilla JS 실행형 Worker이므로 별도 스크립트 없음)

---

## 4. 프로젝트 개발 규칙 (Development Rules)

### 4.1 아키텍처 규칙
- **다층 캐시 순서를 반드시 유지한다**: Cache API (L1) → KV (L2) → 실제 변환 (L3)
- 캐시 히트 시 즉시 반환하고, 불필요한 변환은 절대 실행하지 않는다.
- Tier 변환 우선순위를 유지한다: **Tier 1 (CF Native) → Tier 2 (자체 변환) → Tier 3 (Browser Rendering)**

### 4.2 플랜 권한 규칙
- `FREE_LIMITS`와 `PRO_LIMITS` 상수는 `docs/SPEC.md` (설계서 섹션 3) 기준으로 유지한다.
  - Free: `allowRender: false`, `allowSummary: false`, `allowStructured: false`, `advancedExtraction: false`
  - Pro: 위 항목 모두 `true`
- **convert는 공개 무료** (TASKS 3.3): 구조화 포맷(`json`/`toml`/`yaml`/`json-ld`)·`max_tokens`은 지갑·크레딧 없이 200. Pro 전용은 `render`/`summary`만 — Free가 요청하면 **402 x402 응답** (CPU 절약을 위해 조기 차단)
- Rate Limit: Free `15 RPM / 1,000 RPD`, Pro `120 RPM / 20,000 RPD`

### 4.3 바인딩 규칙
| 바인딩 | 타입 | 설명 |
|-------------|------|------|
| `API_KEYS` | KV Namespace | Pro API Key 인증 |
| `RESULTS_KV` | KV Namespace | L2 변환 결과 캐시 |
| `DB` | D1 Database | Pro 사용량·토큰 통계 |
| `BROWSER` | Browser Rendering | Tier 3 (Pro 전용) |

### 4.4 개발 시 확인 사항
- 새 기능 추가 전 **로드맵(`docs/SPEC.md` 섹션 10)**과 일치 여부를 확인한다.
- D1 통계 기록은 `ctx.waitUntil()`로 비동기 처리하여 응답 지연 없이 동작해야 한다.
- API Key 형식: `aznp_pro_<random_32_chars>`
- 결제 연동은 **Stripe / Lemon Squeezy Webhook → KV 상태 업데이트** 방식으로 한다.

---

## 5. 제약 사항 및 주의사항 (Guardrails)

- `docs/SPEC.md`에 정의되지 않은 스펙을 독단적으로 추가하거나 변경하지 마세요. 스펙 변경이 필요하다고 판단되면 사용자에게 먼저 제안하세요.
- `docs/ARCHITECTURE.md`에 정의된 파일/디렉터리 레이아웃 규칙을 무시하고 임의 위치에 파일을 생성하지 마세요.
- `docs/TASKS.md`에서 이전 단계가 완결되지 않은 상태로 다음 단계 작업을 무단 진행하지 마세요.
- **`npx wrangler deploy` 등의 배포 명령어는 자동 실행하지 않는다.** (사용자가 명시적으로 "배포" 또는 "deploy"를 요청/승인했을 때만 진행)
- **다중 Cloudflare 무료 계정 운영은 절대 권장하지 않는다** (ToS 위반 + 운영 복잡도).
- 트래픽 증가 시 Workers Paid ($5/월) 전환을 권장한다.
- `forceFresh` 없이 캐시를 우회하는 로직을 추가하지 않는다.
- 환경변수 및 비밀 키(API Key 등)가 코드에 하드코딩되지 않도록 항상 `.env` 설정을 유지하세요.