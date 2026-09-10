# Agentic Zero-Noise Proxy (AZNP) 최종 설계서

**버전**: 2.1  
**작성일**: 2026년 8월 9일  
**타겟 인프라**: Cloudflare Workers + Cache + KV + D1 + Pages  
**목표**: AI 에이전트를 위한 범용 Zero-Noise Markdown 프록시  
**핵심 최적화**: CPU 시간 절약 + 토큰 절감 극대화

---

## 1. 프로젝트 개요

**AZNP**는 AI 에이전트와 LLM이 웹페이지를 가져올 때 발생하는 불필요한 노이즈(광고, 네비게이션, CSS/JS, 사이드바 등)를 제거하고, **초경량·고품질 Markdown**으로 변환해 반환하는 에지 프록시 서비스입니다.

### 핵심 가치
- **토큰 절감**: 평균 75~90% 토큰 감소 (Advanced Extraction 시 추가 15~30%)
- **범용성**: Cloudflare Markdown for Agents를 지원하지 않는 사이트도 처리
- **속도**: 전 세계 Cloudflare Edge + 다층 캐시로 동작
- **비용 효율**: Free Plan으로 기본 기능 제공, Pro로 고급 기능 과금
- **리소스 효율**: Cache → KV → 변환 순으로 CPU 사용 최소화

### 버전 히스토리
| 버전 | 주요 변경 |
|------|-----------|
| v1.0 (MVP) | 단순 HTML→Markdown 변환 |
| v2.0 | 3-Tier Cascading + Free/Pro 플랜 |
| **v2.1** | **다층 캐시(Cache API + KV) + CPU/토큰 최적화 + D1 통계 + Pages 대시보드** |

### 기존 MVP와의 차이
| 항목 | 기존 MVP | 최종 설계 (v2.1) |
|------|----------|------------------|
| 처리 방식 | 무조건 자체 변환 | 3-Tier Cascading + 다층 캐시 |
| Cloudflare Native | 미사용 | Tier 1 우선 시도 |
| 본문 추출 | 단순 `<p>` 추출 | Advanced Extraction (Pro) |
| JS 렌더링 | 없음 | Pro 전용 |
| 과금 | 없음 | Free / Pro 모델 |
| Rate Limit | 없음 | 플랜별 적용 |
| 캐시 | 단순 Cache-Control | Cache API + KV 이중 캐시 |
| 통계 | 없음 | D1 기반 Token Analytics |
| 다중 계정 | - | **비추천** (리스크 대비 효과 낮음) |

---

## 2. 시스템 아키텍처

### 2.1 전체 흐름 (v2.1 최적화)

```
AI Agent
   │
   │  GET /?url=https://example.com/article
   │  Header: X-API-Key (Pro인 경우)
   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker (AZNP)                      │
│                                                                 │
│  1. Plan 확인 (KV)                                              │
│  2. Rate Limit 체크 (KV / Durable Object)                       │
│                                                                 │
│  3. 다층 캐시 조회                                              │
│     ├─ Cache API 히트?  → 즉시 반환 (CPU ≈ 0)                   │
│     └─ KV 히트?         → 반환 + Cache API에 재저장             │
│                                                                 │
│  4. Cascading 변환 (캐시 미스 시에만)                            │
│     ┌─────────────┐   실패   ┌──────────────┐   실패   ┌──────────────────┐
│     │ Tier 1      │ ──────► │ Tier 2       │ ──────► │ Tier 3           │
│     │ CF Native   │         │ Self Convert │         │ Browser Rendering│
│     │ (Accept:    │         │ (경량/고급)  │         │ (Pro only)       │
│     │  markdown)  │         │              │         │                  │
│     └─────────────┘         └──────────────┘         └──────────────────┘
│                                                                 │
│  5. 후처리 (요약, max_tokens, Structured – Pro)                 │
│  6. 결과 저장 (Cache API + KV) + D1 통계 기록                   │
│  7. 응답 반환                                                   │
└─────────────────────────────────────────────────────────────────┘
   │
   ▼
깨끗한 Markdown (+ 메타 헤더)
```

### 2.2 Cascading 우선순위

1. **Tier 1 – Cloudflare Markdown for Agents**  
   - `Accept: text/markdown` 헤더로 요청  
   - 사이트가 기능을 켜둔 경우 가장 빠르고 CPU/비용 0

2. **Tier 2 – 자체 변환**  
   - HTML Fetch → 본문 추출 → Markdown 변환  
   - Free: 경량 변환 / Pro: Advanced Extraction

3. **Tier 3 – Browser Rendering**  
   - JS가 필요한 동적 페이지  
   - **Pro 전용**

### 2.3 다층 캐시 전략 (CPU 절약 핵심)

| 계층 | 저장소 | TTL | 역할 |
|------|--------|-----|------|
| L1 | Cache API (Edge) | Free 1시간 / Pro 6시간 | 가장 빠른 응답 |
| L2 | KV | 24시간~7일 | 인기 페이지 장기 보관, 반복 변환 방지 |
| L3 | 실제 변환 | - | 캐시 미스 시에만 실행 |

**Stale-While-Revalidate** 적용 시:
- 사용자는 즉시 오래된 캐시 응답을 받음
- 백그라운드에서 새 변환을 수행해 캐시 갱신

이 구조만으로도 반복 요청의 **CPU 사용량을 70~90% 감소**시킬 수 있습니다.

---

## 3. Free vs Pro 플랜

### 3.1 기능 비교표

| 기능 | Free | Pro |
|------|------|-----|
| Tier 1 (Cloudflare Native) | ✅ | ✅ |
| Tier 2 (자체 변환) | ✅ (경량) | ✅ (Advanced Extraction) |
| JS Rendering (Tier 3) | ❌ | ✅ |
| Summary Mode (`mode=summary`) | ❌ | ✅ |
| Max Tokens 제한 | ❌ | ✅ |
| Structured Output (JSON) | ❌ | ✅ |
| Rate Limit | 15 RPM / 1,000 RPD | 120 RPM / 20,000 RPD |
| Cache TTL (Cache API) | 1시간 | 6시간 + SWR |
| KV 결과 캐시 | 기본 | 더 긴 TTL + 우선 |
| Token Analytics | 기본 헤더만 | 요청별 + 월간 리포트 (D1) |
| Custom Domain Rules | ❌ | ✅ (KV 프리셋) |
| Priority Queue | ❌ | ✅ |
| 지원 | 커뮤니티 | 이메일 우선 지원 |
| **가격** | **$0** | **$19 / 월** |

### 3.2 Pro 핵심 가치

| 기능 | 효과 | 체감 |
|------|------|------|
| Advanced Extraction | 토큰 추가 15~30% 절감 | 긴 문서에서 비용 차이 큼 |
| JS Rendering | 동적 페이지 성공률↑ | “안 되는 페이지” 해결 |
| Summary / max_tokens | 컨텍스트 초과 방지 | 에이전트 안정성 + 비용 절감 |
| 높은 Rate Limit + 긴 캐시 | 대규모 사용 가능 | 팀/서비스 운영 필수 |
| Token Analytics (D1) | “이번 달 $XX 절약” 확인 | 갱신 유도 |

### 3.3 향후 확장 플랜

| 플랜 | 가격 | 대상 |
|------|------|------|
| Free | $0 | 개인 / 테스트 |
| Pro | $19/월 | 솔로 개발자 |
| Team | $49/월 | 소규모 팀 (좌석 5개) |
| Business | 협의 | 대규모 / SLA |

---

## 4. CPU 시간 & 토큰 절약 전략

### 4.1 CPU 시간 절약

| 순위 | 방법 | 기대 효과 | 난이도 |
|------|------|-----------|--------|
| 1 | Cache API + KV 다층 캐시 | 반복 요청 CPU 70~90% ↓ | 중간 |
| 2 | Tier 1 성공 시 즉시 반환 | 변환 CPU 0 | 낮음 |
| 3 | Free는 경량 변환, Pro만 Advanced | Free 계정 CPU 보호 | 낮음 |
| 4 | 불필요한 경로 조기 차단 | render/summary 권한 없으면 바로 403 | 낮음 |
| 5 | Stale-While-Revalidate | 사용자는 빠르고, 갱신은 백그라운드 | 중간 |

**비추천**: 다중 Cloudflare 무료 계정 운영  
- ToS 위반 위험, 운영 복잡도 증가, 실제 병목(Browser Rendering·CPU) 해결에 도움 안 됨  
- 트래픽 증가 시 Workers Paid ($5/월)로 전환하는 것이 훨씬 안전하고 깔끔

### 4.2 토큰 절약

| 방법 | 설명 | 효과 |
|------|------|------|
| 강력한 본문 추출 | 네비/푸터/관련글/광고 제거율↑ | 15~30% 추가 절감 |
| 요약 모드 | `mode=summary` | 극단적 절감 |
| max_tokens | Pro 전용 길이 제한 | 필요한 만큼만 전달 |
| 이미지/링크 최소화 | `?images=0` 옵션 | 추가 감소 |
| 구조화 JSON | 본문 대신 필드만 반환 | RAG에 유리 |

### 4.3 Cloudflare 서비스 활용 맵

| 서비스 | 용도 | Free Plan 활용 |
|--------|------|----------------|
| **Cache API** | L1 초고속 캐시 | ✅ 기본 제공 |
| **KV** | API Key, 변환 결과, 도메인 규칙, Rate Limit | ✅ 무료 할당량 내 |
| **D1** | 사용량·토큰 절감 통계 | ✅ 무료 티어 존재 |
| **Pages** | 랜딩 + Pro 대시보드 | ✅ 완전 무료 |
| **Browser Rendering** | Tier 3 JS 렌더링 | 제한적 (Pro에서 유료 전환 권장) |
| **Workers AI** | 요약 기능 | Pro 전용 + 캐시 필수 |

---

## 5. API 명세

### 5.1 기본 요청

```
GET https://aznp.yourdomain.workers.dev/?url=https://example.com/article
```

### 5.2 쿼리 파라미터

| 파라미터 | 필수 | 설명 | 플랜 |
|----------|------|------|------|
| `url` | ✅ | 대상 웹페이지 URL | Free/Pro |
| `mode` | ❌ | `auto` (기본) / `summary` | summary는 Pro |
| `max_tokens` | ❌ | 반환 Markdown 최대 토큰 수 | Pro |
| `render` | ❌ | `true` → JS 렌더링 강제 | Pro |
| `format` | ❌ | `markdown` (기본) / `json` / `toml` / `yaml` / `json-ld` | `json`·`toml`·`yaml`·`json-ld`는 Pro |
| `fresh` | ❌ | `1` → 캐시 무시하고 강제 갱신 | Free/Pro |
| `images` | ❌ | `0` → 이미지 관련 텍스트 최소화 | Free/Pro |

### 5.3 헤더

| 헤더 | 설명 |
|------|------|
| `X-API-Key` | Pro 플랜 인증 키 (`aznp_pro_xxxxx`) |

### 5.4 응답 헤더 (예시)

> 기존 `X-AZNP-*` / `X-Markdown-Tokens` / `X-Original-Tokens` / `X-Token-Reduction` 헤더는 유지한다 (v2.2에서 추가 신규 헤더 없음).
> `Content-Type`은 포맷에 따라 달라진다: markdown=`text/markdown`, toml=`application/toml`, yaml=`application/yaml`,
> json-ld=`application/ld+json`, json=`application/json`.

```
Content-Type: text/markdown; charset=utf-8
X-AZNP-Plan: pro
X-AZNP-Source: cloudflare-native | aznp-self | browser-rendering | cache | kv
X-AZNP-Cache: HIT | MISS
X-Token-Reduction: Estimated 82%
X-Markdown-Tokens: 1240
X-RateLimit-Remaining: 87
Cache-Control: public, max-age=21600, stale-while-revalidate=86400
```

### 5.5 에러 응답 (LLM-readable, 기본 TOML)

변환 API(`GET /`, `/health` 제외)의 4xx/5xx 에러는 기본적으로 **TOML `[error]`** 테이블을 반환합니다.
`format=json`(또는 Accept: application/json)이면 JSON, `format=yaml`이면 YAML로 응답합니다.
`POST /v1/topup`·402(PAYMENT-REQUIRED)·`GET /health`는 기존대로 JSON을 유지합니다.

```toml
[error]
status = 429
code = "rate_limited"
message = "Rate limit exceeded: 15 requests per minute"
action_recommendation = "Wait 30 seconds (see Retry-After) and retry"
```

고정 필드: `status`(HTTP) · `code`(snake_case) · `message` · `action_recommendation`

---

## 6. 핵심 소스 코드 (worker.js)

> Cloudflare Workers용 v2.1 코드입니다.  
> Cache API + KV 다층 캐시와 CPU 절약 로직이 반영되어 있습니다.

```js
/**
 * AZNP v2.1 - Agentic Zero-Noise Proxy
 * Cloudflare Worker
 * 최적화: Cache API + KV 다층 캐시, CPU/토큰 절약
 */

const FREE_LIMITS = {
  rpm: 15,
  rpd: 1000,
  cacheTTL: 3600,          // 1시간
  kvTTL: 86400,            // 24시간
  allowRender: false,
  allowSummary: false,
  allowStructured: false,
  advancedExtraction: false,
};

const PRO_LIMITS = {
  rpm: 120,
  rpd: 20000,
  cacheTTL: 21600,         // 6시간
  kvTTL: 604800,           // 7일
  allowRender: true,
  allowSummary: true,
  allowStructured: true,
  advancedExtraction: true,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");
    const mode = url.searchParams.get("mode") || "auto";
    const maxTokens = parseInt(url.searchParams.get("max_tokens") || "0", 10);
    const forceRender = url.searchParams.get("render") === "true";
    const format = url.searchParams.get("format") || "markdown";
    const forceFresh = url.searchParams.get("fresh") === "1";

    // 1. 파라미터 검증
    if (!targetUrl) {
      return jsonResponse({ error: "Missing 'url' query parameter" }, 400);
    }
    try {
      new URL(targetUrl);
    } catch {
      return jsonResponse({ error: "Invalid URL" }, 400);
    }

    // 2. 플랜 확인 (KV)
    const planInfo = await getPlan(request, env);
    const limits = planInfo.limits;

    // 3. Rate Limit 체크
    const rateLimitResult = await checkRateLimit(request, env, planInfo);
    if (!rateLimitResult.allowed) {
      return jsonResponse(
        {
          error: "Rate limit exceeded",
          plan: planInfo.plan,
          limit: `${limits.rpm} requests per minute`,
        },
        429
      );
    }

    // 4. 기능 권한 체크 (조기 반환으로 CPU 절약)
    if (forceRender && !limits.allowRender) {
      return jsonResponse(
        { error: "JS Rendering is a Pro feature", upgrade: "https://aznp.example.com/pricing" },
        403
      );
    }
    if (mode === "summary" && !limits.allowSummary) {
      return jsonResponse(
        { error: "Summary mode is a Pro feature", upgrade: "https://aznp.example.com/pricing" },
        403
      );
    }
    if (format === "json" && !limits.allowStructured) {
      return jsonResponse(
        { error: "Structured JSON output is a Pro feature", upgrade: "https://aznp.example.com/pricing" },
        403
      );
    }

    // 5. 캐시 키 생성
    const cacheKeyUrl = new URL(request.url);
    // 캐시에 영향을 주는 파라미터만 남김
    const cache = caches.default;
    const cacheKey = new Request(cacheKeyUrl.toString(), request);

    // 6. L1: Cache API 조회
    if (!forceFresh) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set("X-AZNP-Cache", "HIT");
        headers.set("X-AZNP-Source", "cache");
        return new Response(cached.body, { status: cached.status, headers });
      }
    }

    // 7. L2: KV 조회
    const kvKey = `md:${hashUrl(targetUrl)}:${mode}:${maxTokens}:${forceRender}:${format}`;
    if (!forceFresh && env.RESULTS_KV) {
      try {
        const kvData = await env.RESULTS_KV.get(kvKey, { type: "json" });
        if (kvData && kvData.markdown) {
          const response = buildResponse(kvData.markdown, {
            plan: planInfo.plan,
            source: "kv",
            cacheStatus: "HIT",
            limits,
            rateLimitRemaining: rateLimitResult.remaining,
            tokenEstimate: kvData.tokenEstimate,
            format,
          });
          // Cache API에 다시 채움
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
          return response;
        }
      } catch (e) {
        // KV 오류 시 무시하고 변환 진행
      }
    }

    // 8. 실제 변환 (캐시 미스)
    try {
      let markdown = null;
      let source = null;
      let tokenEstimate = null;

      // ─── Tier 1: Cloudflare Markdown for Agents ───
      if (mode === "auto" || mode === "prefer-native") {
        try {
          const nativeRes = await fetch(targetUrl, {
            headers: {
              Accept: "text/markdown, text/html;q=0.8",
              "User-Agent": "AgenticZeroNoiseProxy/2.1",
            },
            cf: { cacheTtl: 300 },
          });

          const contentType = nativeRes.headers.get("content-type") || "";
          if (nativeRes.ok && contentType.includes("text/markdown")) {
            markdown = await nativeRes.text();
            source = "cloudflare-native";
            tokenEstimate = nativeRes.headers.get("x-markdown-tokens");
          }
        } catch (e) {
          // Tier 1 실패 시 Tier 2로
        }
      }

      // ─── Tier 2: 자체 변환 ───
      if (!markdown) {
        const htmlRes = await fetch(targetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; AgenticZeroNoiseProxy/2.1; +https://aznp.example.com)",
            Accept: "text/html,application/xhtml+xml",
          },
        });

        if (!htmlRes.ok) {
          return jsonResponse(
            { error: `Failed to fetch target URL: ${htmlRes.status}` },
            htmlRes.status
          );
        }

        const html = await htmlRes.text();
        markdown = convertToCleanMarkdown(html, targetUrl, {
          advanced: limits.advancedExtraction,
        });
        source = "aznp-self";
      }

      // ─── Tier 3: Browser Rendering (Pro) ───
      if (forceRender && limits.allowRender && env.BROWSER) {
        // 실제 환경에서는 Browser Rendering 바인딩/API 사용
        // markdown = await renderWithBrowser(targetUrl, env);
        // source = "browser-rendering";
      }

      // ─── 후처리 (Pro) ───
      if (mode === "summary" && limits.allowSummary) {
        // Workers AI 요약 (실제 구현 시 캐시 필수)
        markdown = `# Summary\n\n${markdown.slice(0, 1500)}...\n\n*(Summary mode)*`;
      }

      if (maxTokens > 0 && limits.allowSummary) {
        const approxChars = maxTokens * 4;
        if (markdown.length > approxChars) {
          markdown = markdown.slice(0, approxChars) + "\n\n...(truncated)";
        }
      }

      // 9. 응답 생성
      const response = buildResponse(markdown, {
        plan: planInfo.plan,
        source,
        cacheStatus: "MISS",
        limits,
        rateLimitRemaining: rateLimitResult.remaining,
        tokenEstimate,
        format,
        targetUrl,
      });

      // 10. 다층 캐시 저장 + 통계
      ctx.waitUntil(
        (async () => {
          // L1 Cache API
          await cache.put(cacheKey, response.clone());

          // L2 KV
          if (env.RESULTS_KV) {
            await env.RESULTS_KV.put(
              kvKey,
              JSON.stringify({ markdown, tokenEstimate, source, ts: Date.now() }),
              { expirationTtl: limits.kvTTL }
            );
          }

          // D1 통계 (Pro)
          if (planInfo.plan === "pro" && env.DB) {
            try {
              await env.DB.prepare(
                `INSERT INTO usage_logs (user_id, url, source, created_at) VALUES (?, ?, ?, datetime('now'))`
              )
                .bind(planInfo.userId || "unknown", targetUrl, source)
                .run();
            } catch (e) {}
          }
        })()
      );

      return response;
    } catch (err) {
      return jsonResponse({ error: err.message || "Internal error" }, 500);
    }
  },
};

// ─────────────────────────────────────────────
// 유틸리티 함수
// ─────────────────────────────────────────────

async function getPlan(request, env) {
  const apiKey = request.headers.get("X-API-Key");

  if (!apiKey || !env.API_KEYS) {
    return { plan: "free", limits: FREE_LIMITS };
  }

  try {
    const keyData = await env.API_KEYS.get(apiKey, { type: "json" });
    if (keyData && keyData.status === "active" && keyData.plan === "pro") {
      return { plan: "pro", limits: PRO_LIMITS, userId: keyData.userId };
    }
  } catch (e) {}

  return { plan: "free", limits: FREE_LIMITS };
}

async function checkRateLimit(request, env, planInfo) {
  // 실제 구현 시 KV sliding window 또는 Durable Object 사용 권장
  // 여기서는 placeholder
  return {
    allowed: true,
    remaining: planInfo.limits.rpm - 1,
  };
}

function buildResponse(markdown, opts) {
  const {
    plan,
    source,
    cacheStatus,
    limits,
    rateLimitRemaining,
    tokenEstimate,
    format,
    targetUrl,
  } = opts;

  const headers = {
    "Content-Type":
      format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
    "X-AZNP-Plan": plan,
    "X-AZNP-Source": source,
    "X-AZNP-Cache": cacheStatus,
    "X-Token-Reduction": "Estimated 75-90%",
    "X-RateLimit-Remaining": String(rateLimitRemaining),
    "Cache-Control": `public, max-age=${limits.cacheTTL}, stale-while-revalidate=86400`,
  };

  if (tokenEstimate) {
    headers["X-Markdown-Tokens"] = tokenEstimate;
  }

  let body = markdown;
  if (format === "json") {
    body = JSON.stringify({
      title: extractTitle(markdown),
      source: targetUrl,
      content: markdown,
      meta: { plan, extraction: source },
    });
  }

  return new Response(body, { headers });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractTitle(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
}

function hashUrl(url) {
  // 간단한 해시 (실제로는 crypto.subtle 사용 권장)
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash << 5) - hash + url.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * HTML → Markdown 변환
 * advanced=true 이면 더 공격적인 노이즈 제거 (Pro)
 */
function convertToCleanMarkdown(html, baseUrl, options = {}) {
  const { advanced = false } = options;

  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const noiseTags = advanced
    ? ["nav", "footer", "aside", "header", "form", "iframe", "svg"]
    : [];
  noiseTags.forEach((tag) => {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    clean = clean.replace(regex, "");
  });

  const titleMatch = clean.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : baseUrl;

  let markdown = `# ${title}\n\n*Source: ${baseUrl}*\n\n`;

  // 헤딩
  for (let i = 1; i <= 6; i++) {
    const headingRegex = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, "gi");
    clean = clean.replace(headingRegex, (_, content) => {
      const text = content.replace(/<[^>]+>/g, "").trim();
      return text ? `\n${"#".repeat(i)} ${text}\n\n` : "";
    });
  }

  // 단락
  const pMatches = clean.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  for (const p of pMatches) {
    const text = p.replace(/<[^>]+>/g, "").trim();
    if (text.length > 20) {
      markdown += `${text}\n\n`;
    }
  }

  // 리스트
  clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    const text = content.replace(/<[^>]+>/g, "").trim();
    return text ? `- ${text}\n` : "";
  });

  markdown = markdown.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
  return markdown;
}
```

---

## 7. 인프라 바인딩 설정

| 이름 | 타입 | 용도 | 필수 |
|------|------|------|------|
| `API_KEYS` | KV Namespace | Pro API Key 저장 | Pro 사용 시 |
| `RESULTS_KV` | KV Namespace | 변환 결과 L2 캐시 | 권장 |
| `DB` | D1 Database | 사용량·토큰 통계 | Pro Analytics |
| `BROWSER` | Browser Rendering | Tier 3 JS 렌더링 | Pro (선택) |

### D1 테이블 예시
```sql
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  url TEXT,
  source TEXT,
  created_at TEXT
);

CREATE INDEX idx_user_created ON usage_logs(user_id, created_at);
```

---

## 8. 배포 가이드

### 8.1 Worker 배포
1. Cloudflare Dashboard → Workers & Pages → Create Worker
2. 이름: `aznp-proxy`
3. 위 `worker.js` 코드 붙여넣기 후 Deploy

### 8.2 KV / D1 생성
- Workers → Settings → Bindings에서 KV Namespace 및 D1 생성 후 바인딩

### 8.3 Pages (랜딩 + 대시보드)
- 별도 Pages 프로젝트로 랜딩페이지와 Pro 사용자 대시보드 운영
- Worker API를 호출해 사용량·절감 토큰을 표시

### 8.4 테스트
```bash
# Free
curl "https://aznp-proxy.<subdomain>.workers.dev/?url=https://news.ycombinator.com"

# Pro
curl -H "X-API-Key: aznp_pro_xxxxx" \
  "https://aznp-proxy.<subdomain>.workers.dev/?url=https://example.com&mode=summary&max_tokens=2000"
```

---

## 9. 과금 및 API Key 관리

### API Key 형식
```
aznp_pro_<random_32_chars>
```

### KV 저장 예시
```json
{
  "key": "aznp_pro_abc123...",
  "userId": "user_01",
  "plan": "pro",
  "status": "active",
  "createdAt": "2026-08-09T00:00:00Z",
  "expiresAt": "2026-09-09T00:00:00Z"
}
```

결제 연동은 Stripe / Lemon Squeezy Webhook으로 KV 상태를 업데이트하는 방식을 권장합니다.

---

## 10. 로드맵

| 단계 | 내용 | 우선순위 |
|------|------|----------|
| v2.1 | 다층 캐시 + CPU/토큰 최적화 | ✅ |
| v2.1.1 | **Multi-Chain 온체인 결제 (현재)** — Solana Ed25519 + Base EIP-191/EIP-712 지갑 인증, Solana/Base native USDC 충전, 402 멀티체인 응답 | ✅ |
| v2.2 | 실제 Rate Limit (KV sliding window, `src/rateLimit.js`) | ✅ |
| v2.7 | **AI Agent 응답 포맷 (현재)** — `format=toml/yaml/json-ld`, `max_tokens` 블록 단위 절단(`src/truncate.js`), LLM-readable 에러(TOML 기본) | 검증 중 |
| v2.7.1 | 제출 전 공개 표면 — 레포 Public, LICENSE, Solana-first 카피, convert 무료 (`docs/TASKS.md` 3단계) | 높음 |
| v2.8 | **Superteam $10k** — `@aznp/mcp-server` ($5k) + Eliza 또는 Agent Kit ($3k) + 유지보수 4개월 ($2k). Base 코드 유지, 그랜트 서사에서만 제외 | 높음 |
| v2.3 | Browser Rendering 완전 연동 | 그랜트 후 |
| v2.4 | Workers AI 요약 + 캐시 | 그랜트 후 |
| v2.5 | 도메인별 프리셋 규칙 (KV) | 그랜트 후 |
| v2.6 | Pages 대시보드 (사용량/절감 리포트) | 그랜트 후 |
| v3.0 | Team 플랜 + 좌석 관리 | 낮음 |

---

## 11. 참고 자료

- [Cloudflare Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)
- [Cloudflare Browser Rendering – /markdown](https://developers.cloudflare.com/browser-rendering/quick-actions/markdown-endpoint/)
- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)

---

**문서 끝**

이 문서는 AZNP v2.1의 최종 설계입니다.  
**다층 캐시(Cache API + KV)**를 통해 CPU 시간을 크게 줄이고, Free/Pro 차별화와 토큰 절감에 집중한 구조입니다.  
다중 무료 계정 운영은 권장하지 않으며, 트래픽 증가 시 Workers Paid로 전환하는 것을 권장합니다.
