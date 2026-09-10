# AZNP – Agentic Zero-Noise Proxy

> AI 에이전트를 위한 **Zero-Noise Markdown 프록시** — 공개 무료(public good).  
> 웹페이지를 초경량 Clean Markdown으로 변환해 LLM 토큰 비용을 75~90% 절감합니다.  
> 지갑·API Key 없이 누구나 호출할 수 있으며, Solana Ed25519 서명은 **신원(identity)** 용도로 선택 사용합니다.

---

## 💡 핵심 특징

- **무료 convert**: `GET /?url=...` — 로그인·API Key·크레딧 없이 바로 200. `markdown` / `json` / `toml` / `yaml` / `json-ld` 전 포맷 지원
- **`max_tokens`**: 출력을 토큰 예산 안에서 블록 단위로 절단 (무료)
- **75~90% 토큰 절감**: 지저분한 HTML(광고, 네비게이션, CSS/JS 등)을 제거해 LLM 비용 극대화
- **Solana Ed25519 무상태 인증 (선택)**: 본인 지갑 키페어가 곧 계정 ID. 가입·API Key 발급 불필요, 서버는 비밀키를 받지 않음 (요청 신원용)
- **Pro OpenAPI Spec Compression**: `openapi.json` / `swagger.json` URL 요청 시 80~90% 초경량 압축 반환 (Pro 전용, Free는 307 Redirect)
- **File Bypass**: PDF·이미지·영상 등 파일 URL은 변환 없이 원본으로 307 Redirect 처리
- **AI 표준 규격 노출**: `/llms.txt` · `/llms-full.txt` · `/openapi.json` — 인증 없이 200
- **3-Tier Cascading Engine**: Tier 1 (Cloudflare Native) → Tier 2 (자체 고속 변환) → Tier 3 (Browser Rendering `render=true`)
- **다층 에지 캐시**: Cache API (L1) + Cloudflare KV (L2) 이중 캐싱으로 초고속 응답 (CPU 시간 최소화)

> **그랜트 범위**: Base(EVM L2) 멀티체인·유료 크레딧(topup)·Browser Rendering은 **코드는 유지**하되 이번 Superteam 그랜트 제품이 아닙니다 (아래 "Out of grant scope" 참고).

---

## 🚀 사용법 — 무료 즉시 시작 (인증 불필요)

```bash
# 기본 Markdown
curl "https://aznp-proxy.kerberos79.workers.dev/?url=https://news.ycombinator.com"

# 구조화 JSON (무료)
curl "https://aznp-proxy.kerberos79.workers.dev/?url=https://example.com&format=json"

# 토큰 예산 (무료)
curl "https://aznp-proxy.kerberos79.workers.dev/?url=https://example.com&max_tokens=2000"
```

선택적으로 Solana 지갑 서명을 추가하면 요청 신원 + 상위 Rate Limit을 받습니다 (아래 "Solana 서명 (선택)" 참고).

---

## 🚀 API 규격

### 1. Markdown 변환 요청 (`GET /?url=...`)

변환 자체는 **인증 없이 무료**입니다. Solana Ed25519 서명은 선택 사항(요청 신원 표시)입니다.

#### 기본 요청 (서명 없이)
```bash
curl "https://aznp-proxy.kerberos79.workers.dev/?url=https://news.ycombinator.com"
```

#### 주요 쿼리 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `url` | 필수 | 대상 웹페이지 URL |
| `format` | `markdown` | `markdown` (기본) / `json` / `toml` / `yaml` / `json-ld` — **전 포맷 무료** |
| `max_tokens` | `0` | 최대 토큰 제한 (**무료**) |
| `images` | `1` | `0` → 이미지 제외 |
| `mode` | `auto` | `auto` / `summary` (summary는 Pro) |
| `render` | `false` | `true` → JS 렌더링 강제 (Pro) |
| `fresh` | `0` | `1` → 캐시 우회 |

#### 응답 헤더

| 헤더 | 설명 |
|--------|------|
| `X-AZNP-Plan` | 현재 플랜 (`free` / `pro`) |
| `X-AZNP-Source` | 변환 방식 (`cloudflare-native`, `aznp-self`, `bypass` 등) |
| `X-AZNP-Cache` | 캐시 상태 (`HIT` / `MISS` / `BYPASS`) |
| `X-Token-Reduction` | 토큰 절감률 (ex: `87%`) |
| `X-AZNP-Bypass` | `true` → 파일 URL로 인해 bypass 적용됨 |
| `X-AZNP-Bypass-Reason` | bypass 원인이 된 Content-Type |

---

### 2. Solana 서명 (선택 — 신원 확인)

지갑 키페어로 `x402:{timestamp}` 메시지를 Ed25519 서명해 헤더로 보내면, 요청 신원을 확인하고 상위 Rate Limit을 적용합니다. (가입·API Key 발급 불필요, 서버는 비밀키를 받지 않습니다.)

```bash
curl "https://aznp-proxy.kerberos79.workers.dev/?url=https://news.ycombinator.com" \
  -H "x-wallet-address: 7xKX...AgentSolanaPublicKey" \
  -H "x-timestamp: 1786249000" \
  -H "x-signature: 3mZ...Ed25519SignatureBase58"
```

> Base(EVM L2) 지갑 서명(EIP-191 / EIP-712)도 **코드는 유지**되나 그랜트 서사에는 포함하지 않습니다.

---

### 3. AI 표준 문서 엔드포인트 (인증 없이 200)

| 엔드포인트 | 설명 |
|------------|------|
| `GET /llms.txt` | LLM AI 에이전트용 요약 가이드 (무료 convert, Solana 서명) |
| `GET /llms-full.txt` | 전체 API 명세 및 에러 코드, Node.js/Python 예시 |
| `GET /openapi.json` | OpenAPI 3.0.3 표준 JSON 스펙 (Custom GPTs / LangChain 연동용) |
| `GET /robots.txt` | AI 에이전트/크롤러 접근 허용 규칙 |
| `GET /health` | 서비스 헬스체크 (`auth: solana-ed25519`)

---

## 📦 File Bypass 동작

AZNP는 HTML이 아닌 파일 URL을 탐지하면 **변환 없이 원본 응답을 투명하게 프록시**합니다.

### Bypass 대상 조건

| 방식 | 예시 |
|------|------|
| **URL 확장자 기반** (조기 판별) | `.pdf`, `.png`, `.mp4`, `.zip`, `.docx` 등 |
| **Content-Type 기반** | `image/*`, `video/*`, `audio/*`, `application/pdf` 등 |

### Bypass 응답 예시

```bash
# PDF 요청 시 변환 없이 원본 PDF 바이트가 그대로 전달됩니다.
curl -I "https://aznp-proxy.kerberos79.workers.dev/?url=https://example.com/report.pdf"
# X-AZNP-Bypass: true
# X-AZNP-Bypass-Reason: application/pdf
# X-AZNP-Source: bypass
# X-AZNP-Cache: BYPASS
```

> **Note**: Bypass 응답은 KV/Cache에 저장되지 않습니다. 토큰 절감률 헤더도 포함되지 않습니다.

---

## 🛠️ Cloudflare GitHub 자동 배포 (CI/CD)

Cloudflare Dashboard에서 GitHub 저장소(`aznp-worker`)를 연동하여 `git push` 시 자동 배포되도록 설정합니다.

### Cloudflare Workers Build & Deploy 설정값

- **Build command**: `npm install`
- **Deploy command**: `npx wrangler deploy`
- **Root directory**: `/`
- **Build output directory**: *(비워둠)*

---

## 🔒 환경 변수 (`wrangler.toml`)

```toml
[vars]
UPGRADE_URL = "https://aznp.pages.dev/pricing"
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
X402_NETWORK = "solana"

[[kv_namespaces]]
binding = "RESULTS_KV"
id = "45301c3029b84f90830d7275c01a311c"

[[kv_namespaces]]
binding = "API_KEYS"
id = "15e38ac172464389bd646a225c8c0552"

[[d1_databases]]
binding = "DB"
database_name = "aznp-analytics"
database_id = "5ad6d12d-4121-4120-a4b4-bba3f5db93e3"

[browser]
binding = "BROWSER"
```

---

## 🚫 Out of grant scope (그랜트 제품 아님 — 코드는 유지)

아래 기능은 **호환성·기존 사용자**를 위해 코드는 그대로 유지하지만, 이번 Superteam 마이크로그랜트($10k)의 **제품·서사에 포함하지 않습니다**.

### 유료 크레딧 — 온체인 충전 (`POST /v1/topup`, Solana/Base USDC)

| 티어 | 최소 충전액 | 부여 크레딧 (요청 횟수) | 건당 단가 |
|------|------------|------------------------|-----------|
| **Pro Agent** | **$20 USDC** | **12,000회** | **$0.00166** |
| **Enterprise** | **$100 USDC** | **80,000회** | **$0.00125** |

```bash
curl -X POST "https://aznp-proxy.kerberos79.workers.dev/v1/topup" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "7xKX...AgentSolanaPublicKey",
    "tx_hash": "5K...SolanaTransactionHash"
  }'
```

- 수신 서비스 지갑 (Solana): `GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E`
- USDC Mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Lemon Squeezy / 수동 Pro API Key (`X-API-Key: aznp_pro_...`)도 존재하나 그랜트 제품 아님

### Base (EVM L2) 멀티체인

Solana 외 Base 지갑(EIP-191 / EIP-712) 인증·Base native USDC 충전·`networks[]`의 base 객체는 **코드로 지원**하되, 그랜트 서사·README 앞면·`/health` 카피에서는 제외합니다.

### Browser Rendering (Pro Tier 3)

`render=true` 시 JS 렌더링 폴백 경로는 유지하되, 완전 연동·정식 기능은 **이번 그랜트 범위 밖**입니다.

---

## 📄 라이선스

MIT License. See [`LICENSE`](LICENSE).
