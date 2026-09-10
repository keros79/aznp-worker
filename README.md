# AZNP – Agentic Zero-Noise Proxy v2.1

> AI 에이전트를 위한 **Zero-Noise Markdown 프록시 & Stateless Payment Edge API**  
> 웹페이지를 초경량 Clean Markdown으로 변환해 LLM 토큰 비용을 75~90% 절감합니다.

---

## 💡 핵심 특징

- **75~90% 토큰 절감**: 지저분한 HTML(광고, 네비게이션, CSS/JS 등)을 완벽 제거해 LLM 비용 극대화
- **Pro OpenAPI Spec Compression**: `openapi.json` / `swagger.json` URL 요청 시 80~90% 초경량 파싱 및 압축 반환 (Pro 전용, Free는 307 Redirect)
- **File Bypass**: PDF·이미지·영상 등 파일 URL은 변환 없이 원본으로 307 Redirect 처리
- **Multi-Chain Wallet-based Stateless Auth**: 회원가입이나 API Key 발급 없이 본인 지갑 주소를 계정 ID로 사용 — **Solana(Ed25519)** + **Base(EIP-191 / EIP-712)** 지원, 체인별 독립 크레딧(`acc:` / `acc:base:`)과 native USDC 충전
- **AI 표준 규격 노출**: 도메인 루트에서 `/llms.txt`, `/llms-full.txt`, `/openapi.json`을 제공하여 AI 에이전트들이 스스로 학습하고 이용 가능
- **3-Tier Cascading Engine**: Tier 1 (Cloudflare Native) → Tier 2 (자체 고속 변환) → Tier 3 (Browser Rendering `render=true`)
- **다층 에지 캐시**: Cache API (L1) + Cloudflare KV (L2) 이중 캐싱으로 초고속 응답 (CPU 시간 최소화)

---

## 💳 요금 체계 (Solana USDC)

AI 에이전트 및 이용자를 위한 마이크로페이먼트 요금 구조입니다.

| 티어 | 최소 충전액 | 부여 크레딧 (요청 횟수) | 건당 단가 | 출금 수수료(0.7 USDC) 비중 | LLM 토큰 절감 가치 |
|------|------------|------------------------|-----------|--------------------------------|-------------------|
| **Pro Agent** | **$20 USDC** | **12,000회** | **$0.00166** (약 2.1원) | **3.5%** (카드 수수료 수준) | 약 $840 (약 110만원 절감) |
| **Enterprise** | **$100 USDC** | **80,000회** | **$0.00125** (약 1.6원) | **0.7%** (수수료 극소화) | 약 $5,600 (약 730만원 절감) |

- **최소 충전 요건**: **$20 USDC** ($20 미만 입금 시 충전 거부)
- **수신 서비스 지갑 주소 (Solana)**: `GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E`
- **USDC Mint Address**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

---

## 🚀 사용법 및 API 규격

### 1. 온체인 충전 (`POST /v1/topup`)

USDC 입금 후 트랜잭션 해시(`tx_hash`)와 본인의 지갑 주소(`wallet`)를 제출하여 크레딧을 충전합니다.

```bash
curl -X POST "https://aznp-proxy.kerberos79.workers.dev/v1/topup" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "7xKX...AgentSolanaPublicKey",
    "tx_hash": "5K...SolanaTransactionHash"
  }'
```

---

### 2. Markdown 변환 요청 (`GET /?url=...`)

에이전트는 API 호출 시 `x402:{timestamp}` 메시지를 본인의 Solana 비밀키로 Ed25519 서명하여 헤더로 전달합니다.

#### 기본 요청
```bash
curl -X GET "https://aznp-proxy.kerberos79.workers.dev/?url=https://news.ycombinator.com" \
  -H "x-wallet-address: 7xKX...AgentSolanaPublicKey" \
  -H "x-timestamp: 1786249000" \
  -H "x-signature: 3mZ...Ed25519SignatureBase58"
```

#### 주요 쿼리 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `url` | 필수 | 대상 웹페이지 URL |
| `render` | `false` | `true` → JS 렌더링 강제 (Tier 3 Browser Rendering) |
| `mode` | `auto` | `auto` / `summary` (요약 모드) |
| `format` | `markdown` | `markdown` (기본) / `json` / `toml` / `yaml` / `json-ld` (구조화는 Pro) |
| `max_tokens` | `0` | 최대 토큰 제한 |
| `images` | `1` | `0` → 이미지 제외 |

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

### 3. AI 표준 문서 엔드포인트

| 엔드포인트 | 설명 |
|------------|------|
| `GET /llms.txt` | LLM AI 에이전트용 요약 가이드 (API 개요, 요금, 헤더) |
| `GET /llms-full.txt` | 전체 API 명세 및 Node.js/Python 코드 예시 |
| `GET /openapi.json` | OpenAPI 3.0.3 표준 JSON 스펙 (Custom GPTs / LangChain 연동용) |
| `GET /robots.txt` | AI 에이전트/크롤러 접근 허용 규칙 |
| `GET /health` | 서비스 헬스체크 |

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

## 📄 라이선스

MIT License. See [`LICENSE`](LICENSE).
