/**
 * AZNP v2.2 - 응답 포맷 직렬화 모듈 (markdown / toml / yaml / json-ld / json)
 *
 * 외부 직렬화 라이브러리를 추가하지 않고 고정 스키마를 자체 직렬화한다 (AGENTS.md 4.2).
 * 변환 파이프라인: 마크다운 생성 → truncate(max_tokens) → format 직렬화 (본 모듈).
 *
 * - markdown : 원본 마크다운 그대로 (Free/Pro)
 * - toml     : 메타·Key-Value 중심, 긴 본문은 멀티라인 문자열 `"""` (Pro)
 * - yaml     : 메타 + 본문은 literal block `|` (Pro)
 * - json-ld  : Schema.org Article (@context/@type) (Pro)
 * - json     : 기존 `{ title, source, content, meta }` 하위 호환 (Pro)
 */

// ─── 허용 포맷 ─────────────────────────────────────────────────────────────────
export const ALLOWED_FORMATS = ['markdown', 'toml', 'yaml', 'json-ld', 'json'];

// ─── Content-Type ─────────────────────────────────────────────────────────────
export function contentTypeFor(format) {
  switch (format) {
    case 'markdown':
      return 'text/markdown; charset=utf-8';
    case 'toml':
      return 'application/toml; charset=utf-8';
    case 'yaml':
      return 'application/yaml; charset=utf-8';
    case 'json-ld':
      return 'application/ld+json; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    default:
      return 'text/markdown; charset=utf-8';
  }
}

// ─── 이스케이프 헬퍼 (에러 응답에서도 재사용) ───────────────────────────────────

/** TOML basic string (큰따옴표 포함) */
export function escapeTomlString(str) {
  return (
    '"' +
    String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') +
    '"'
  );
}

/** TOML 멀티라인 기본 문자열 (내부 """ 는 \""" 로 이스케이프) */
function tomlMultiline(str) {
  const cleaned = String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, '\\"""')
    .replace(/\r\n/g, '\n');
  return `"""\n${cleaned}\n"""`;
}

/** YAML 인라인 문자열 (JSON 인코딩으로 안전하게) */
export function escapeYamlString(str) {
  return JSON.stringify(String(str));
}

/** YAML literal block (`|`) */
function yamlBlock(str) {
  const lines = String(str).replace(/\t/g, '  ').split('\n');
  if (lines.length === 0) return '""\n';
  return '|\n' + lines.map((l) => (l === '' ? '' : '  ' + l)).join('\n');
}

// ─── 공통 ──────────────────────────────────────────────────────────────────────

/** Markdown에서 첫 번째 H1 제목 추출 */
function extractTitle(markdown) {
  const m = String(markdown).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : 'Untitled';
}

// ─── TOML ──────────────────────────────────────────────────────────────────────
function toToml(markdown, { plan, targetUrl, tokenEstimate, source }) {
  return (
    `title = ${escapeTomlString(extractTitle(markdown))}\n` +
    `source = ${escapeTomlString(targetUrl)}\n` +
    `tokens = ${Number(tokenEstimate) || 0}\n\n` +
    `[meta]\n` +
    `plan = ${escapeTomlString(plan)}\n` +
    `extraction = ${escapeTomlString(source || '')}\n\n` +
    `content = ${tomlMultiline(markdown)}\n`
  );
}

// ─── YAML ──────────────────────────────────────────────────────────────────────
function toYaml(markdown, { plan, targetUrl, tokenEstimate, source }) {
  return (
    `title: ${escapeYamlString(extractTitle(markdown))}\n` +
    `source: ${escapeYamlString(targetUrl)}\n` +
    `tokens: ${Number(tokenEstimate) || 0}\n` +
    `meta:\n` +
    `  plan: ${escapeYamlString(plan)}\n` +
    `  extraction: ${escapeYamlString(source || '')}\n` +
    `content: ${yamlBlock(markdown)}\n`
  );
}

// ─── JSON-LD ───────────────────────────────────────────────────────────────────
function toJsonLd(markdown, { plan, targetUrl, tokenEstimate, source }) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: extractTitle(markdown),
    url: targetUrl,
    encodingFormat: 'text/markdown',
    articleBody: markdown,
    meta: {
      plan,
      extraction: source,
      tokens: Number(tokenEstimate) || 0,
    },
  });
}

// ─── JSON (기존 하위 호환) ─────────────────────────────────────────────────────
function toJson(markdown, { plan, targetUrl, tokenEstimate, originalTokenEstimate, source, tokenReduction }) {
  return JSON.stringify({
    title: extractTitle(markdown),
    source: targetUrl,
    content: markdown,
    meta: {
      plan,
      extraction: source,
      tokens: tokenEstimate,
      original_tokens: originalTokenEstimate,
      token_reduction: tokenReduction || '',
    },
  });
}

/**
 * 마크다운을 요청된 format으로 직렬화한 `{ body, contentType }` 반환.
 * format은 호출부에서 사전에 ALLOWED_FORMATS로 검증된 값이어야 한다.
 */
export function serializeResponse(markdown, opts) {
  const { format } = opts;
  switch (format) {
    case 'toml':
      return { body: toToml(markdown, opts), contentType: contentTypeFor('toml') };
    case 'yaml':
      return { body: toYaml(markdown, opts), contentType: contentTypeFor('yaml') };
    case 'json-ld':
      return { body: toJsonLd(markdown, opts), contentType: contentTypeFor('json-ld') };
    case 'json':
      return { body: toJson(markdown, opts), contentType: contentTypeFor('json') };
    case 'markdown':
    default:
      return { body: markdown, contentType: contentTypeFor('markdown') };
  }
}
