/**
 * AZNP v2.1 - AI 발견 엔드포인트 정적 문서 모듈 (TASKS 3.4)
 *
 * - `/llms.txt`, `/llms-full.txt`, `/openapi.json`, `/robots.txt`
 * - 인증 불필요 · 캐시 키 미사용 · 그랜트 제품(copy)은 Solana-first + 무료 convert만 앞면
 * - Base(EVM)·유료 topup·Browser Rendering은 코드 유지하되 그랜트 제품이 아님을 명기
 */

// ─── `/llms.txt` — AI 에이전트용 요약 가이드 ─────────────────────────────────
export const LLMS_TXT = `# AZNP

Convert any URL to clean, token-efficient Markdown for AI agents and LLMs.

- Free public good. No API key, wallet, or signup needed to convert.
- GET /?url=<absolute http(s) URL>
  - format: markdown (default) | json | toml | yaml | json-ld  (all free)
  - max_tokens: truncate the output to a token budget (free)
  - images=0: drop images from the output
- GET /health        — service status
- GET /openapi.json  — OpenAPI 3.0.3 specification
- GET /llms-full.txt — full API reference (params, headers, error codes, examples)

Optional Solana Ed25519 request signing (identity, not billing):
  x-wallet-address: <Base58 Ed25519 public key>
  x-timestamp:      <unix seconds>
  x-signature:      <Base58 Ed25519 signature over "x402:{timestamp}">

Planned: @aznp/mcp-server (stdio + remote MCP endpoint) wrapping this Worker.
Paid Pro credits (POST /v1/topup with USDC) and the Base (EVM) chain are kept
for compatibility but are NOT part of the grant product.
`;
// ─── `/llms-full.txt` — 전체 API 명세 ────────────────────────────────────────
export const LLMS_FULL_TXT = `# AZNP — Full API Reference

AZNP converts any URL to clean, token-efficient Markdown for AI agents.

## Endpoints

- GET /?url=<target>   Convert a URL (free, no auth required)
- GET /health          Service status (JSON)
- GET /llms.txt        Short guide for AI agents (project summary)
- GET /llms-full.txt   This full reference
- GET /openapi.json    OpenAPI 3.0.3 spec of GET / and GET /health
- GET /robots.txt      Crawler allow rules
- POST /v1/topup       (out of grant scope) USDC credit top-up, kept for compatibility

## Query parameters (GET /)

| Parameter  | Default   | Description                                    |
|------------|-----------|------------------------------------------------|
| url        | (required)| Target http(s) URL                            |
| format     | markdown  | markdown | json | toml | yaml | json-ld       |
| max_tokens | 0         | Truncate to N tokens (est. ceil(chars/4))      |
| mode       | auto      | auto (summary is Pro-only)                     |
| render     | false     | true = force JS render (Pro-only)              |
| images     | 1         | 0 = drop images                                |
| fresh      | 0         | 1 = bypass cache                               |

All formats and max_tokens are FREE for anonymous requests.

## Response headers

- X-AZNP-Plan: free | pro
- X-AZNP-Source: cloudflare-native | aznp-self | browser-rendering | kv | cache-api
- X-AZNP-Cache: HIT | MISS
- X-Markdown-Tokens / X-Original-Tokens / X-Token-Reduction
- X-RateLimit-Remaining / X-RateLimit-Reset

## Error codes (TOML [error] by default; JSON when format=json)

| Status | code                    | action_recommendation                       |
|--------|-------------------------|---------------------------------------------|
| 400    | missing_url / invalid_url / unsupported_format / max_tokens_too_large / chain_mismatch | fix the parameter |
| 404    | not_found               | use GET /?url=... or the endpoints above    |
| 429    | rate_limited            | wait Retry-After seconds                    |
| 502    | fetch_failed            | check URL reachability and retry            |
| 500    | internal_error          | retry a limited number of times             |

## Solana Ed25519 signature (optional, identity not billing)

Sign the message "x402:{timestamp}" (timestamp = unix seconds) with your Solana
keypair and send the headers below. Signed requests get rate-limit uplift.

    x-wallet-address: <Base58 public key>
    x-timestamp:      <unix seconds>
    x-signature:      <Base58 Ed25519 detached signature>

## Examples

curl:
  curl "https://<host>/?url=https://news.ycombinator.com&format=json"

Node.js:
  const res = await fetch("https://<host>/?url=https://example.com&format=json", {
    headers: { "Accept": "application/json" }
  });
  const data = await res.json();

Python:
  import urllib.request, json
  url = "https://<host>/?url=https://example.com&format=json"
  with urllib.request.urlopen(url) as r:
      data = json.load(r)
`;
// ─── `/openapi.json` — OpenAPI 3.0.3 (GET / · /health 만, 그랜트 카피) ───────
export const OPENAPI_JSON = JSON.stringify(
  {
    openapi: '3.0.3',
    info: {
      title: 'AZNP — Agentic Zero-Noise Proxy',
      description:
        'Free public-good web-to-Markdown converter for AI agents. Convert any URL to clean, token-efficient Markdown. Optional Solana Ed25519 header signing is identity, not billing. Paid Pro credits and the Base (EVM) chain exist for compatibility but are out of grant scope.',
      version: '2.1.0',
    },
    servers: [{ url: '/' }],
    paths: {
      '/': {
        get: {
          summary: 'Convert a URL to clean Markdown (free, no auth)',
          parameters: [
            { name: 'url', in: 'query', required: true, schema: { type: 'string', format: 'uri' }, description: 'Target http(s) URL' },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['markdown', 'json', 'toml', 'yaml', 'json-ld'], default: 'markdown' }, description: 'Output format (all free)' },
            { name: 'max_tokens', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100000 }, description: 'Truncate to N tokens (free)' },
            { name: 'images', in: 'query', schema: { type: 'integer', enum: [0, 1], default: 1 }, description: '0 to drop images' },
            { name: 'fresh', in: 'query', schema: { type: 'integer', enum: [0, 1], default: 0 }, description: '1 to bypass cache' },
          ],
          responses: {
            '200': { description: 'Converted markdown document' },
            '400': { description: 'missing_url / invalid_url / unsupported_format / max_tokens_too_large' },
            '404': { description: 'not_found' },
            '429': { description: 'rate_limited (see Retry-After)' },
            '502': { description: 'fetch_failed' },
            '500': { description: 'internal_error' },
          },
        },
      },
      '/health': {
        get: {
          summary: 'Service health',
          responses: { '200': { description: '{ status, version, auth }' } },
        },
      },
    },
  },
  null,
  2
);

// ─── `/robots.txt` ────────────────────────────────────────────────────────────
export const ROBOTS_TXT = `User-agent: *
Allow: /
`;