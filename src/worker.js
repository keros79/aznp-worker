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
 *  - File Bypass: PDF·이미지·영상 등 파일은 변환 없이 투명 프록시 처리
 */

import { convertToCleanMarkdown, estimateTokens, estimateOriginalTokens } from './htmlToMarkdown.js';
import { compressOpenApiSpec } from './openapiCompressor.js';
import { checkRateLimit } from './rateLimit.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'X-API-Key, Content-Type, x-wallet-address, x-signature, x-timestamp, PAYMENT-SIGNATURE, X-PAYMENT',
  'Access-Control-Expose-Headers':
    'X-AZNP-Plan, X-AZNP-Source, X-AZNP-Cache, X-Token-Reduction, X-Markdown-Tokens, X-Original-Tokens, X-RateLimit-Remaining, X-RateLimit-Reset, PAYMENT-REQUIRED',
};

// ─── Bypass 대상 MIME 타입 프리픽스 ─────────────────────────────────────────────
// 아래 타입은 HTML 변환 없이 원본 응답을 그대로 투명 프록시(bypass) 처리합니다.
const BYPASS_MIME_PREFIXES = [
  'application/pdf',
  'application/zip', 'application/x-zip', 'application/x-gzip',
  'application/octet-stream',
  'application/msword', 'application/vnd.',
  'image/',
  'video/',
  'audio/',
  'font/',
];

// ─── Bypass 대상 URL 확장자 (fetch 전 조기 판별) ─────────────────────────────────
const BYPASS_EXTENSIONS = new Set([
  'pdf', 'zip', 'gz', 'tar', 'rar', '7z', 'bz2',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tiff',
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv',
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'exe', 'dmg', 'pkg', 'deb', 'apk', 'msi',
  'xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx',
]);

// ─── Worker 메인 핸들러 ───────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    // Preflight OPTIONS 처리
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // [Route 1] Solana USDC 입금 충전 엔드포인트 (POST /v1/topup)
    if (url.pathname === '/v1/topup' && request.method === 'POST') {
      return handleTopup(request, env);
    }

    // GET 이외 메서드 차단
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed. Use GET.' }, 405);
    }

    // 헬스체크 엔드포인트
    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', version: '2.1', auth: 'solana-wallet-stateless' }, 200);
    }

    // 루트 경로: 간단한 안내
    if (url.pathname !== '/' && url.pathname !== '') {
      return jsonResponse(
        { error: 'Not found. Use GET /?url=<target_url> or POST /v1/topup', docs: UPGRADE_URL },
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

    // ─── 3. 기능 권한 및 x402 결제 체크 ────────────────────────────────────
    const requiresPro = forceRender || mode === 'summary' || format === 'json' || maxTokens > 0;
    if (requiresPro && planInfo.plan === 'free') {
      return x402PaymentRequiredResponse(env, 'This feature requires payment via x402 or a Pro API Key.');
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

    // ─── 4-b. OpenAPI / Swagger URL 감지 및 처리 ─────────────────────────────────
    // URL 패턴(openapi.json, swagger.json 등) 감지 시:
    // Pro 플랜 → 90% 압축된 초경량 OpenAPI 스펙 반환
    // Free 플랜 → 원본 URL로 307 Redirect (바이패스)
    if (isOpenApiUrl(targetUrl)) {
      if (planInfo.plan === 'pro') {
        try {
          const specRes = await fetch(targetUrl, {
            headers: { 'User-Agent': 'AgenticZeroNoiseProxy/2.1 (+https://aznp.pages.dev)' },
            signal: AbortSignal.timeout(10000),
          });
          if (specRes.ok) {
            const specText = await specRes.text();
            const compressedSpec = compressOpenApiSpec(specText);
            const origTokens = estimateOriginalTokens(specText);
            const compTokens = estimateTokens(compressedSpec);

            return new Response(compressedSpec, {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json; charset=utf-8',
                'X-AZNP-Plan': 'pro',
                'X-AZNP-Source': 'openapi-compressed',
                'X-AZNP-Cache': 'MISS',
                'X-Markdown-Tokens': String(compTokens),
                'X-Original-Tokens': String(origTokens),
                'X-Token-Reduction': `${Math.max(0, Math.round((1 - compTokens / origTokens) * 100))}%`,
                'X-RateLimit-Remaining': String(rateLimitResult.remaining),
              },
            });
          }
        } catch (e) {
          console.error('[AZNP] OpenAPI fetch error:', e.message);
        }
      }

      // Free 플랜 사용자는 에러 차단 대신 원본 URL로 307 Redirect (바이패스)
      return buildBypassRedirect(targetUrl, {
        contentType: 'application/json (openapi-free-bypass)',
        rateLimitRemaining: rateLimitResult.remaining,
        plan: planInfo.plan,
      });
    }

    // ─── 4-c. URL 확장자 기반 조기 Bypass (307 Redirect) ─────────────────────────
    // fetch 없이 URL 패턴만으로 판별해 원본 URL로 직접 redirect합니다.
    if (isBypassExtension(targetUrl)) {
      return buildBypassRedirect(targetUrl, {
        contentType: 'file/extension-matched',
        rateLimitRemaining: rateLimitResult.remaining,
        plan: planInfo.plan,
      });
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
          // 파일 Content-Type 감지 → 307 Redirect로 원본 URL으로 직접 안내
          if (isBypassContentType(contentType)) {
            return buildBypassRedirect(targetUrl, {
              contentType,
              rateLimitRemaining: rateLimitResult.remaining,
              plan: planInfo.plan,
            });
          }
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

      // ── Tier 3: Browser Rendering (Pro 전용) ─────────────────────────────
      if (forceRender && limits.allowRender) {
        if (env.BROWSER) {
          try {
            const puppeteer = await import('@cloudflare/puppeteer');
            const browser = await puppeteer.launch(env.BROWSER);
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 15000 });

            const renderedHtml = await page.content();
            await browser.close();

            if (renderedHtml && renderedHtml.length > 100) {
              markdown = convertToCleanMarkdown(renderedHtml, targetUrl, {
                advanced: limits.advancedExtraction,
                includeImages,
              });
              originalHtml = renderedHtml;
              source = 'browser-rendering';
            }
          } catch (bErr) {
            console.warn('[AZNP] Tier 3 Browser Rendering failed/fallback:', bErr.message);
          }
        }
      }

      // ── Tier 2: 자체 변환 (Tier 1 또는 Tier 3 미적용 시) ───────────────────
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
            // HTML이 아닌 경우 (PDF, 이미지, 바이너리 등) → 307 Redirect
            return buildBypassRedirect(targetUrl, {
              contentType: ct,
              rateLimitRemaining: rateLimitResult.remaining,
              plan: planInfo.plan,
            });
          }

          html = await htmlRes.text();
        }

        markdown = convertToCleanMarkdown(html, targetUrl, {
          advanced: limits.advancedExtraction,
          includeImages,
        });
        originalHtml = originalHtml || html;
        source = forceRender ? 'aznp-self-render-fallback' : 'aznp-self';
      }

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

// ─────────────────────────────────────────────────────────────────────────────
// 유틸리티 및 무키 결제 핸들러
// ─────────────────────────────────────────────────────────────────────────────

/**
 * [Route 1] 온체인 Solana USDC 충전 핸들러 (POST /v1/topup)
 */
async function handleTopup(request, env) {
  try {
    const { wallet, tx_hash } = await request.json();

    if (!wallet || !tx_hash) {
      return jsonResponse({ error: 'wallet and tx_hash parameters are required' }, 400);
    }

    const kvStore = env.RESULTS_KV || env.API_KEYS;
    if (!kvStore) {
      return jsonResponse({ error: 'KV binding (RESULTS_KV) is not configured' }, 500);
    }

    // ① 트랜잭션 중복 처리 검증
    const txProcessed = await kvStore.get(`tx:${tx_hash}`);
    if (txProcessed) {
      return jsonResponse({ error: 'Transaction already processed' }, 400);
    }

    // ② Solana RPC 온체인 트랜잭션 파싱
    const rpcUrl = env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const rpcRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          tx_hash,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
        ]
      })
    });

    const rpcData = await rpcRes.json();
    const tx = rpcData?.result;

    if (!tx || tx.meta?.err) {
      return jsonResponse({ error: 'Invalid or failed transaction hash on Solana blockchain' }, 400);
    }

    // ③ USDC 전송량 검증 (수신 지갑 잔액 증가분)
    const serviceWallet = env.SERVICE_WALLET_ADDRESS || 'GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E';
    const usdcMint = env.USDC_MINT_ADDRESS || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    const postBalances = tx.meta?.postTokenBalances || [];
    const preBalances = tx.meta?.preTokenBalances || [];

    const postTarget = postBalances.find(b => b.owner === serviceWallet && b.mint === usdcMint);
    const preTarget = preBalances.find(b => b.owner === serviceWallet && b.mint === usdcMint);

    const postAmount = postTarget?.uiTokenAmount?.uiAmount || 0;
    const preAmount = preTarget?.uiTokenAmount?.uiAmount || 0;
    const amountUSDC = postAmount - preAmount;

    // ④ 최소 $20 USDC 입금 검증
    if (amountUSDC < 20) {
      return jsonResponse({
        error: 'Minimum deposit requirement is $20 USDC',
        received_usdc: amountUSDC,
        min_required: 20,
        tiers: {
          'Pro Agent': '$20 USDC = 12,000 requests',
          'Enterprise': '$100 USDC = 80,000 requests'
        }
      }, 400);
    }

    // ⑤ 크레딧 계산 ($100 이상 시 800회/$, $20~$99.99 시 600회/$)
    let addedCredits = 0;
    if (amountUSDC >= 100) {
      addedCredits = Math.floor(amountUSDC * 800); // Enterprise Tier
    } else {
      addedCredits = Math.floor(amountUSDC * 600); // Pro Agent Tier
    }

    // ⑥ KV 중복 마킹 (30일 TTL) 및 남은 크레딧 count 저장
    await kvStore.put(`tx:${tx_hash}`, 'processed', { expirationTtl: 2592000 });

    let currentCount = parseInt((await kvStore.get(`acc:${wallet}:count`)) || '-1', 10);
    if (currentCount < 0) {
      const allowed = parseInt((await kvStore.get(`acc:${wallet}:allowed`)) || '0', 10);
      const used = parseInt((await kvStore.get(`acc:${wallet}:used`)) || '0', 10);
      currentCount = Math.max(0, allowed - used);
    }

    const newCount = currentCount + addedCredits;
    await kvStore.put(`acc:${wallet}:count`, newCount.toString());
    await kvStore.put(`acc:${wallet}:allowed`, newCount.toString());

    return jsonResponse({
      success: true,
      wallet,
      deposited_usdc: amountUSDC,
      added_credits: addedCredits,
      total_allowed_requests: newCount,
      remaining_count: newCount
    }, 200);

  } catch (err) {
    return jsonResponse({ error: `Topup error: ${err.message}` }, 500);
  }
}

/**
 * 플랜 확인 (Solana Wallet Stateless Auth 우선 -> Pro API Key 차선)
 */
async function getPlan(request, env) {
  const kvStore = env.RESULTS_KV || env.API_KEYS;

  // ─── 1. Solana Wallet Ed25519 무키 서명 인증 ───
  const wallet = request.headers.get('x-wallet-address');
  const signature = request.headers.get('x-signature');
  const timestamp = request.headers.get('x-timestamp');

  if (wallet && signature && timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const reqTime = parseInt(timestamp, 10);

    // 타임스탬프 5분 이내 검증 (리플레이 방지)
    if (isNaN(reqTime) || Math.abs(now - reqTime) > 300) {
      return { plan: 'invalid_timestamp', limits: FREE_LIMITS };
    }

    // Ed25519 서명 검증 ("x402:{timestamp}")
    const message = `x402:${timestamp}`;
    const isValidSig = verifySolanaSignature(message, signature, wallet);

    if (isValidSig && kvStore) {
      let count = parseInt((await kvStore.get(`acc:${wallet}:count`)) || '-1', 10);

      // 하위 호환성: 기존 acc:${wallet}:allowed 및 used 기준 데이터 마이그레이션
      if (count < 0) {
        const allowed = parseInt((await kvStore.get(`acc:${wallet}:allowed`)) || '0', 10);
        const used = parseInt((await kvStore.get(`acc:${wallet}:used`)) || '0', 10);
        count = allowed - used;
      }

      // count가 0 이하일 경우 무료 플랜으로 동작
      if (count <= 0) {
        return { plan: 'free', limits: FREE_LIMITS, wallet, remainingCount: 0 };
      }

      // 유료 요청 1회당 count -1 차감
      const updatedCount = count - 1;
      await kvStore.put(`acc:${wallet}:count`, updatedCount.toString());

      return {
        plan: 'pro',
        limits: PRO_LIMITS,
        userId: wallet,
        authType: 'solana_wallet',
        remainingCredits: updatedCount,
        remainingCount: updatedCount
      };
    }
  }

  // ─── 2. Pro API Key 확인 (하위 호환 및 count 차감) ───
  const apiKey = request.headers.get('X-API-Key');

  if (apiKey && env.API_KEYS) {
    if (/^aznp_(pro|team)_[a-zA-Z0-9]{16,}$/.test(apiKey)) {
      try {
        const keyData = await env.API_KEYS.get(apiKey, { type: 'json' });
        if (
          keyData &&
          keyData.status === 'active' &&
          keyData.plan === 'pro' &&
          (!keyData.expiresAt || new Date(keyData.expiresAt) > new Date())
        ) {
          // keyData에 count 필드가 설정되어 있는 경우 검사 및 -1 차감
          if (keyData.count !== undefined) {
            if (keyData.count <= 0) {
              return { plan: 'free', limits: FREE_LIMITS, userId: keyData.userId, authType: 'api_key' };
            }
            keyData.count = keyData.count - 1;
            await env.API_KEYS.put(apiKey, JSON.stringify(keyData));
          } else {
            // KV에 개별 acc:${apiKey}:count 키가 존재하는지 확인
            const apiCountRaw = await env.API_KEYS.get(`acc:${apiKey}:count`);
            if (apiCountRaw !== null) {
              const apiCount = parseInt(apiCountRaw, 10);
              if (apiCount <= 0) {
                return { plan: 'free', limits: FREE_LIMITS, userId: keyData.userId, authType: 'api_key' };
              }
              await env.API_KEYS.put(`acc:${apiKey}:count`, (apiCount - 1).toString());
            }
          }

          return { plan: 'pro', limits: PRO_LIMITS, userId: keyData.userId, authType: 'api_key' };
        }
      } catch (e) {
        console.error('[AZNP] API_KEYS KV error:', e.message);
      }
    }
  }

  return { plan: 'free', limits: FREE_LIMITS };
}

/**
 * Solana Ed25519 서명 검증 헬퍼
 */
function verifySolanaSignature(message, signatureBase58, publicKeyBase58) {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signatureBase58);
    // bs58 public key -> Uint8Array (32 bytes)
    const publicKeyBytes = bs58.decode(publicKeyBase58);

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (e) {
    return false;
  }
}

/**
 * 402 Payment Required 응답 반환
 */
function x402PaymentRequiredResponse(env, message = 'Payment Required') {
  const payTo = env.SERVICE_WALLET_ADDRESS || 'GuUdPHj3dnafbFvF2gMscCVAMCd4NvSE5ktsrbdAvT4E';

  const paymentDetails = {
    error: 'Payment Required',
    message: 'Insufficient credits or missing Solana Wallet authentication signature.',
    service_wallet: payTo,
    network: 'solana',
    currency: 'USDC',
    min_deposit: '$20 USDC',
    tiers: {
      'Pro Agent': '$20 USDC = 12,000 requests ($0.00166/req)',
      'Enterprise': '$100 USDC = 80,000 requests ($0.00125/req)'
    },
    auth_headers_required: {
      'x-wallet-address': '<SOLANA_PUBLIC_KEY>',
      'x-signature': '<Ed25519_SIGNATURE_OF_x402:{timestamp}>',
      'x-timestamp': '<UNIX_TIMESTAMP>'
    },
    topup_endpoint: 'POST /v1/topup'
  };

  return new Response(
    JSON.stringify(paymentDetails, null, 2),
    {
      status: 402,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'PAYMENT-REQUIRED': JSON.stringify({
          amount: '20.0',
          currency: 'USDC',
          network: 'solana',
          payTo,
          description: 'AZNP Pro Markdown conversion credits'
        }),
      },
    }
  );
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
 * OpenAPI / Swagger URL 패턴 판별
 * (openapi.json, swagger.json, openapi.yaml, swagger.yaml 등)
 */
function isOpenApiUrl(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    const openApiPatterns = [
      'openapi.json', 'swagger.json',
      'openapi.yaml', 'swagger.yaml',
      'openapi.yml', 'swagger.yml',
    ];
    return openApiPatterns.some(pattern => pathname.endsWith(pattern) || pathname.includes(`/${pattern}`));
  } catch {
    return false;
  }
}

/**
 * URL 확장자 기반 Bypass 판별
 * 네트워크 fetch 없이 URL 패턴만으로 파일 여부를 조기 판단합니다.
 */
function isBypassExtension(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    const ext = pathname.split('.').pop()?.split('?')[0] || '';
    return BYPASS_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

/**
 * Content-Type 기반 Bypass 판별
 */
function isBypassContentType(ct) {
  if (!ct) return false;
  const lower = ct.toLowerCase().split(';')[0].trim();
  return BYPASS_MIME_PREFIXES.some(prefix => lower.startsWith(prefix));
}

/**
 * 파일 Bypass — 307 Temporary Redirect
 * - Worker가 파일 데이터를 메모리에 올리지 않고 Agent를 원본 URL로 직접 안내
 * - CF Workers 메모리(128MB) 및 대역폭 비용 제로
 * - Agent는 307 후 자동으로 원본 URL에 직접 접속 (HTTP 클라이언트 기본 동작)
 */
function buildBypassRedirect(targetUrl, opts = {}) {
  const { contentType, rateLimitRemaining, plan } = opts;

  const headers = new Headers({
    ...CORS_HEADERS,
    'Location': targetUrl,
    'X-AZNP-Bypass': 'true',
    'X-AZNP-Bypass-Reason': contentType || 'file',
    'X-AZNP-Plan': plan || 'free',
    'X-AZNP-Source': 'bypass-redirect',
    'X-AZNP-Cache': 'BYPASS',
  });

  if (rateLimitRemaining !== undefined) {
    headers.set('X-RateLimit-Remaining', String(rateLimitRemaining));
  }

  return new Response(null, { status: 307, headers });
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
