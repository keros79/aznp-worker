# AZNP – Agentic Zero-Noise Proxy v2.1

> AI 에이전트를 위한 **Zero-Noise Markdown 프록시** – Cloudflare Workers  
> 웹페이지를 초경량 Markdown으로 변환해 LLM 토큰 비용을 75~90% 절감합니다.

---

## 아키텍처

```
AI Agent
   │  GET /?url=https://example.com/article
   ▼
Cloudflare Worker (AZNP)
   │
   ├─ [L1] Cache API 히트?  ──────────────────────► 즉시 반환 (CPU ≈ 0)
   ├─ [L2] KV 히트?         ──────────────────────► 반환 + L1 재충전
   │
   ├─ Tier 1: CF Markdown for Agents (Accept: text/markdown)
   ├─ Tier 2: 자체 HTML→Markdown 변환
   │
   ├─ 결과 → L1 Cache API + L2 KV 저장
   └─ 깨끗한 Markdown 반환
```

## Free vs Pro

| 기능 | Free | Pro |
|------|:----:|:---:|
| Tier 1 (CF Native) | ✅ | ✅ |
| Tier 2 (자체 변환) | ✅ | ✅ |
| JS Rendering (Tier 3) | ❌ | ✅ |
| Summary Mode | ❌ | ✅ |
| max_tokens | ❌ | ✅ |
| Structured JSON | ❌ | ✅ |
| Rate Limit | 15 RPM / 1,000 RPD | 120 RPM / 20,000 RPD |
| Cache TTL | 1시간 | 6시간 + SWR |
| **가격** | **$0** | **$19/월** |

---

## 빠른 시작

### 1. 의존성 설치

```bash
npm install
```

### 2. KV Namespace 생성

```bash
# 변환 결과 캐시용
npm run kv:create:results
# → 출력된 id를 wrangler.toml의 RESULTS_KV id에 입력

# Pro API Key 저장용
npm run kv:create:apikeys
# → 출력된 id를 wrangler.toml의 API_KEYS id에 입력
```

### 3. `wrangler.toml` 수정

```toml
[[kv_namespaces]]
binding = "RESULTS_KV"
id = "여기에_RESULTS_KV_ID_입력"

[[kv_namespaces]]
binding = "API_KEYS"
id = "여기에_API_KEYS_ID_입력"
```

### 4. 로컬 개발 서버 실행

```bash
npm run dev
# → http://localhost:8787 에서 실행
```

> **팁**: 로컬 dev에서는 KV 바인딩이 없으면 Rate Limit을 건너뜁니다.  
> `.dev.vars` 파일로 환경 변수를 설정할 수 있습니다.

### 5. 배포

```bash
npm run deploy
```

---

## API 사용법

### 기본 요청 (Free)

```bash
curl "https://aznp-proxy.<subdomain>.workers.dev/?url=https://news.ycombinator.com"
```

### `?fresh=1` – 캐시 무시하고 강제 갱신

```bash
curl "https://aznp-proxy.<subdomain>.workers.dev/?url=https://example.com&fresh=1"
```

### `?images=0` – 이미지 제외

```bash
curl "https://aznp-proxy.<subdomain>.workers.dev/?url=https://example.com&images=0"
```

### Pro 요청

```bash
curl -H "X-API-Key: aznp_pro_xxxxx" \
  "https://aznp-proxy.<subdomain>.workers.dev/?url=https://example.com&mode=summary&max_tokens=2000"
```

### 헬스체크

```bash
curl "https://aznp-proxy.<subdomain>.workers.dev/health"
# → {"status":"ok","version":"2.1","plan":"free"}
```

---

## 응답 헤더

| 헤더 | 설명 |
|------|------|
| `X-AZNP-Plan` | `free` 또는 `pro` |
| `X-AZNP-Source` | `cloudflare-native` / `aznp-self` / `cache-api` / `kv(...)` |
| `X-AZNP-Cache` | `HIT` 또는 `MISS` |
| `X-Token-Reduction` | 토큰 절감률 (예: `82%`) |
| `X-Markdown-Tokens` | 변환된 Markdown 토큰 수 추정 |
| `X-Original-Tokens` | 원본 HTML 토큰 수 추정 |
| `X-RateLimit-Remaining` | 남은 요청 수 |
| `X-RateLimit-Reset` | Rate Limit 리셋 시각 (Unix timestamp) |

---

## Pro API Key 등록

Pro API Key 형식: `aznp_pro_<random_32_chars>`

KV에 다음 형식으로 등록:

```bash
wrangler kv key put \
  --namespace-id=<API_KEYS_ID> \
  "aznp_pro_abc123..." \
  '{"userId":"user_01","plan":"pro","status":"active","createdAt":"2026-08-09T00:00:00Z","expiresAt":"2026-09-09T00:00:00Z"}'
```

> 실제 서비스에서는 Stripe / Lemon Squeezy Webhook으로 KV를 자동 업데이트하는 방식을 권장합니다.

---

## 파일 구조

```
aznp/
├── src/
│   ├── worker.js          # 메인 Worker (라우팅, 캐시, Tier 1/2)
│   ├── htmlToMarkdown.js  # HTML → Markdown 변환기
│   └── rateLimit.js       # KV Sliding Window Rate Limiter
├── wrangler.toml          # Cloudflare Workers 설정
├── package.json
├── .gitignore
├── AZNP_Final_Design.md   # 설계서 v2.1
└── README.md
```

---

## 로드맵

| 버전 | 내용 | 상태 |
|------|------|------|
| v2.1 | 다층 캐시 + CPU/토큰 최적화 | ✅ **현재** |
| v2.2 | KV Sliding Window Rate Limit | ✅ **구현됨** |
| v2.3 | Browser Rendering 완전 연동 | 🔜 |
| v2.4 | Workers AI 요약 + 캐시 | 🔜 |
| v2.5 | 도메인별 프리셋 규칙 (KV) | 🔜 |
| v2.6 | Pages 대시보드 (사용량/절감 리포트) | 🔜 |

---

## 참고 자료

- [Cloudflare Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)
- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
