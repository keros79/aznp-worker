/**
 * AZNP v2.1 - Agentic Zero-Noise Proxy
 * Cloudflare Worker - Free Plan Implementation
 *
 * Features:
 *  - Cache API (L1) + KV (L2) 다층 캐시
 *  - Tier 1: Cloudflare Markdown for Agents (Accept: text/markdown)
 *  - Tier 2: Self Convert (경량 HTML→Markdown)
 *  - KV Sliding Window Rate Limit (15 RPM / 1,000 RPD)
 *  - Pro 기능 조기 차단 (403)
 *  - crypto.subtle 기반 URL 해시
 */

import { convertToCleanMarkdown, estimateTokens, estimateOriginalTokens } from './htmlToMarkdown.js';
import { checkRateLimit } from './rateLimit.js';

// ─── 플랜 설정 ────────────────────────────────────────────────────────────────

const FREE_LIMITS = {
  rpm: 15,
  rpd: 1000,
  cacheTTL: 3600,          // 1시간 (Cache API)
  kvTTL: 86400,            // 24시간 (KV)
  allowRender: false,
  allowSummary: false,
  allowStructured: false,
  advancedExtraction: false,
};

const PRO_LIMITS = {
  rpm: 120,
  rpd: 20000,
  cacheTTL: 21600,         // 6시간 (Cache API)
  kvTTL: 604800,           // 7일 (KV)
  allowRender: true,
  allowSummary: true,
  allowStructured: true,
  advancedExtraction: true,
};

// ─── 업그레이드 URL ────────────────────────────────────────────────────────────
const UPGRADE_URL = 'https://aznp.pages.dev/pricing';

// ─── CORS 허용 오리진 ─────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
  'Access-Control-Expose-Headers':
    'X-AZNP-Plan, X-AZNP-Source, X-AZNP-Cache, X-Token-Reduction, X-Markdown-Tokens, X-Original-Tokens, X-RateLimit-Remaining, X-RateLimit-Reset',
};

// ─── Worker 메인 핸들러 ───────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    // Preflight OPTIONS 처리
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET 이외 메서드 차단
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed. Use GET.' }, 405);
    }

    const url = new URL(request.url);

    // 헬스체크 엔드포인트
    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', version: '2.1', plan: 'free' }, 200);
    }

    // 루트 경로: 간단한 안내
    if (url.pathname !== '/' && url.pathname !== '') {
      return jsonResponse(
        { error: 'Not found. Use GET /?url=<target_url>', docs: UPGRADE_URL },
        404
      );
    }

    // ─── 파라미터 파싱 ─────────────────────────────────────────────────────────
    const targetUrl = url.searchParams.get('url');
    const mode = url.searchParams.get('mode') || 'auto';
    const maxTokens = parseInt(url.searchParams.get('max_tokens') || '0', 10);
    const forceRender = url.searchParams.get('render') === 'true';
    const format = url.searchParams.get('format') || 'markdown';
    const forceFresh = url.searchParams.get('fresh') === '1';
    const includeImages = url.searchParams.get('images') !== '0';

    // ─── 1. URL 유효성 검증 ────────────────────────────────────────────────────
    if (!targetUrl) {
      return jsonResponse(
        {
          error: "Missing 'url' query parameter",
          usage: 'GET /?url=https://example.com/article',
          docs: UPGRADE_URL,
        },
        400
      );
    }

    let parsedTargetUrl;
    try {
      parsedTargetUrl = new URL(targetUrl);
      // http/https 프로토콜만 허용
      if (!['http:', 'https:'].includes(parsedTargetUrl.protocol)) {
        throw new Error('Only http and https URLs are allowed');
      }
    } catch (e) {
      return jsonResponse({ error: `Invalid URL: ${e.message}` }, 400);
    }

    // SSRF 방지: 사설 IP 차단
    if (isPrivateHost(parsedTargetUrl.hostname)) {
      return jsonResponse({ error: 'Private/local URLs are not allowed' }, 403);
    }

    // ─── 2. 플랜 확인 (KV) ────────────────────────────────────────────────────
    const planInfo = await getPlan(request, env);
    const limits = planInfo.limits;

    // ─── 3. 기능 권한 조기 차단 (CPU 절약) ────────────────────────────────────
    if (forceRender && !limits.allowRender) {
      return jsonResponse(
        { error: 'JS Rendering (render=true) is a Pro feature', upgrade: UPGRADE_URL },
        403
      );
    }
    if (mode === 'summary' && !limits.allowSummary) {
      return jsonResponse(
        { error: 'Summary mode is a Pro feature', upgrade: UPGRADE_URL },
        403
      );
    }
    if (format === 'json' && !limits.allowStructured) {
      return jsonResponse(
        { error: 'Structured JSON output is a Pro feature', upgrade: UPGRADE_URL },
        403
      );
    }
    if (maxTokens > 0 && !limits.allowSummary) {
      return jsonResponse(
        { error: 'max_tokens parameter is a Pro feature', upgrade: UPGRADE_URL },
        403
      );
    }

    // ─── 4. Rate Limit 체크 ────────────────────────────────────────────────────
    const rateLimitResult = await checkRateLimit(request, env, planInfo);
    if (!rateLimitResult.allowed) {
      const limitType = rateLimitResult.reason === 'rpd'
        ? `${limits.rpd} requests per day`
        : `${limits.rpm} requests per minute`;

      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          plan: planInfo.plan,
          limit: limitType,
          reset_in_seconds: rateLimitResult.resetIn,
          upgrade: UPGRADE_URL,
        }),
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimitResult.resetIn),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + rateLimitResult.resetIn),
          },
        }
      );
    }

    // ─── 5. 캐시 키 생성 ──────────────────────────────────────────────────────
    // 캐시에 영향을 주는 파라미터만 포함
    const canonicalParams = new URLSearchParams();
    canonicalParams.set('url', targetUrl);
    if (mode !== 'auto') canonicalParams.set('mode', mode);
    if (format !== 'markdown') canonicalParams.set('format', format);
    if (!includeImages) canonicalParams.set('images', '0');
    // 플랜별 캐시 분리
    canonicalParams.set('plan', planInfo.plan);

    const cacheKeyStr = `https://aznp-cache.internal/?${canonicalParams.toString()}`;
    const cacheKey = new Request(cacheKeyStr);
    const cache = caches.default;

    // ─── 6. L1: Cache API 조회 ────────────────────────────────────────────────
    if (!forceFresh) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('X-AZNP-Cache', 'HIT');
        headers.set('X-AZNP-Source', 'cache-api');
        headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
        // CORS 헤더 추가
        for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
        return new Response(cached.body, { status: cached.status, headers });
      }
    }

    // ─── 7. L2: KV 조회 ──────────────────────────────────────────────────────
    const urlHash = await hashUrl(targetUrl);
    const imagesFlag = includeImages ? '1' : '0';
    const kvKey = `md:${urlHash}:${mode}:${format}:img${imagesFlag}:${planInfo.plan}`;

    if (!forceFresh && env.RESULTS_KV) {
      try {
        const kvData = await env.RESULTS_KV.get(kvKey, { type: 'json' });
        if (kvData && kvData.markdown) {
          const response = buildResponse(kvData.markdown, {
            plan: planInfo.plan,
            source: `kv(${kvData.source || 'unknown'})`,
            cacheStatus: 'HIT',
            limits,
            rateLimitRemaining: rateLimitResult.remaining,
            tokenEstimate: kvData.tokenEstimate,
            originalTokenEstimate: kvData.originalTokenEstimate,
            format,
          });
          // Cache API에 다시 채움 (백그라운드)
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
          return response;
        }
      } catch (e) {
        // KV 오류 무시하고 변환 진행
        console.error('[AZNP] KV read error:', e.message);
      }
    }

    // ─── 8. 실제 변환 ─────────────────────────────────────────────────────────
    try {
      let markdown = null;
      let source = null;
      let originalHtml = null;

      // ── Tier 1: Cloudflare Markdown for Agents ──────────────────────────────
      if (mode === 'auto' || mode === 'prefer-native') {
        try {
          const nativeRes = await fetch(targetUrl, {
            headers: {
              Accept: 'text/markdown, text/html;q=0.8, */*;q=0.5',
              'User-Agent': 'AgenticZeroNoiseProxy/2.1 (+https://aznp.pages.dev)',
            },
            cf: {
              cacheTtl: 300,
              cacheEverything: false,
            },
            signal: AbortSignal.timeout(8000), // 8초 타임아웃
          });

          const contentType = nativeRes.headers.get('content-type') || '';
          if (nativeRes.ok && contentType.includes('text/markdown')) {
            markdown = await nativeRes.text();
            source = 'cloudflare-native';
          } else {
            // HTML로 폴백하기 위해 body 저장
            if (nativeRes.ok && (contentType.includes('text/html') || contentType.includes('application/xhtml'))) {
              originalHtml = await nativeRes.text();
            }
          }
        } catch (e) {
          console.log('[AZNP] Tier 1 failed, falling back to Tier 2:', e.message);
        }
      }

      // ── Tier 2: 자체 변환 ──────────────────────────────────────────────────
      if (!markdown) {
        let html = originalHtml;

        if (!html) {
          const htmlRes = await fetch(targetUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (compatible; AgenticZeroNoiseProxy/2.1; +https://aznp.pages.dev)',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'ko,en;q=0.9',
              'Accept-Encoding': 'gzip, deflate, br',
            },
            cf: { cacheTtl: 300 },
            signal: AbortSignal.timeout(10000), // 10초 타임아웃
          });

          if (!htmlRes.ok) {
            return jsonResponse(
              { error: `Failed to fetch target URL: HTTP ${htmlRes.status}` },
              502
            );
          }

          const ct = htmlRes.headers.get('content-type') || '';
          if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
            // HTML이 아닌 경우 (PDF, 이미지 등)
            return jsonResponse(
              { error: `Unsupported content type: ${ct}. Only HTML pages are supported.` },
              415
            );
          }

          html = await htmlRes.text();
        }

        markdown = convertToCleanMarkdown(html, targetUrl, {
          advanced: limits.advancedExtraction,
          includeImages,
        });
        originalHtml = originalHtml || html;
        source = 'aznp-self';
      }

      // ── Tier 3: Browser Rendering (Pro 전용, 이 파일에선 미구현) ────────────
      // Free plan에선 Tier 3 없음

      // ─── 9. 후처리 ───────────────────────────────────────────────────────────
      // Summary (Pro)
      if (mode === 'summary' && limits.allowSummary) {
        markdown = `# Summary\n\n${markdown.slice(0, 1500)}...\n\n*(Summary mode — upgrade to Pro for full AI summarization)*`;
      }

      // max_tokens (Pro)
      if (maxTokens > 0 && limits.allowSummary) {
        const approxChars = maxTokens * 4;
        if (markdown.length > approxChars) {
          markdown = markdown.slice(0, approxChars) + '\n\n...(truncated by max_tokens)';
        }
      }

      // ─── 10. 토큰 추정 ────────────────────────────────────────────────────────
      const tokenEstimate = estimateTokens(markdown);
      const originalTokenEstimate = originalHtml
        ? estimateOriginalTokens(originalHtml)
        : tokenEstimate;

      // ─── 11. 응답 생성 ────────────────────────────────────────────────────────
      const response = buildResponse(markdown, {
        plan: planInfo.plan,
        source,
        cacheStatus: 'MISS',
        limits,
        rateLimitRemaining: rateLimitResult.remaining,
        rateLimitReset: Math.ceil(Date.now() / 1000) + rateLimitResult.resetIn,
        tokenEstimate,
        originalTokenEstimate,
        format,
        targetUrl,
      });

      // ─── 12. 백그라운드: 다층 캐시 저장 ──────────────────────────────────────
      ctx.waitUntil(
        (async () => {
          try {
            // L1 Cache API
            await cache.put(cacheKey, response.clone());

            // L2 KV
            if (env.RESULTS_KV) {
              await env.RESULTS_KV.put(
                kvKey,
                JSON.stringify({
                  markdown,
                  source,
                  tokenEstimate,
                  originalTokenEstimate,
                  ts: Date.now(),
                  url: targetUrl,
                }),
                { expirationTtl: limits.kvTTL }
              );
            }
          } catch (e) {
            console.error('[AZNP] Cache save error:', e.message);
          }
        })()
      );

      return response;
    } catch (err) {
      console.error('[AZNP] Error:', err);
      return jsonResponse({ error: err.message || 'Internal server error' }, 500);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸리티 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 플랜 확인 (KV에서 API Key 조회)
 */
async function getPlan(request, env) {
  const apiKey = request.headers.get('X-API-Key');

  if (!apiKey || !env.API_KEYS) {
    return { plan: 'free', limits: FREE_LIMITS };
  }

  // API Key 형식 기본 검증
  if (!/^aznp_(pro|team)_[a-zA-Z0-9]{16,}$/.test(apiKey)) {
    return { plan: 'free', limits: FREE_LIMITS };
  }

  try {
    const keyData = await env.API_KEYS.get(apiKey, { type: 'json' });
    if (
      keyData &&
      keyData.status === 'active' &&
      keyData.plan === 'pro' &&
      (!keyData.expiresAt || new Date(keyData.expiresAt) > new Date())
    ) {
      return { plan: 'pro', limits: PRO_LIMITS, userId: keyData.userId };
    }
  } catch (e) {
    console.error('[AZNP] API_KEYS KV error:', e.message);
  }

  return { plan: 'free', limits: FREE_LIMITS };
}

/**
 * 응답 생성
 */
function buildResponse(markdown, opts) {
  const {
    plan,
    source,
    cacheStatus,
    limits,
    rateLimitRemaining,
    rateLimitReset,
    tokenEstimate,
    originalTokenEstimate,
    format,
    targetUrl,
  } = opts;

  // 토큰 절감률 계산
  let reductionPct = '';
  if (originalTokenEstimate && originalTokenEstimate > 0 && tokenEstimate) {
    const pct = Math.round((1 - tokenEstimate / originalTokenEstimate) * 100);
    reductionPct = `${Math.max(0, pct)}%`;
  }

  const headers = {
    ...CORS_HEADERS,
    'Content-Type':
      format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
    'X-AZNP-Plan': plan,
    'X-AZNP-Source': source,
    'X-AZNP-Cache': cacheStatus,
    'Cache-Control': `public, max-age=${limits.cacheTTL}, stale-while-revalidate=86400`,
    'X-RateLimit-Remaining': String(rateLimitRemaining),
  };

  if (tokenEstimate) headers['X-Markdown-Tokens'] = String(tokenEstimate);
  if (originalTokenEstimate) headers['X-Original-Tokens'] = String(originalTokenEstimate);
  if (reductionPct) headers['X-Token-Reduction'] = reductionPct;
  if (rateLimitReset) headers['X-RateLimit-Reset'] = String(rateLimitReset);

  let body = markdown;
  if (format === 'json') {
    body = JSON.stringify({
      title: extractTitle(markdown),
      source: targetUrl,
      content: markdown,
      meta: {
        plan,
        extraction: source,
        tokens: tokenEstimate,
        original_tokens: originalTokenEstimate,
        token_reduction: reductionPct,
      },
    });
  }

  return new Response(body, { headers });
}

/**
 * JSON 응답 헬퍼
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

/**
 * Markdown 제목 추출
 */
function extractTitle(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

/**
 * URL → SHA-256 해시 (hex, 12자리)
 * crypto.subtle 사용 (Workers 환경 지원)
 */
async function hashUrl(url) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  } catch {
    // crypto.subtle 실패 시 폴백 (개발 환경)
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = (hash << 5) - hash + url.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * SSRF 방지: 사설/루프백 IP 차단
 */
function isPrivateHost(hostname) {
  // localhost
  if (hostname === 'localhost' || hostname === '::1') return true;
  // IPv4 사설 대역
  const privateRanges = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^169\.254\./, // Link-local
    /^0\./,
  ];
  return privateRanges.some(r => r.test(hostname));
}
