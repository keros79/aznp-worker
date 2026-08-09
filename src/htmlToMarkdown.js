/**
 * AZNP v2.1 - HTML → Clean Markdown 변환기
 *
 * Free:     기본 노이즈 제거 + 핵심 컨텐츠 추출
 * Advanced: 더 공격적인 노이즈 제거 (Pro 전용)
 */

// ─── Free 기본 노이즈 태그 ───────────────────────────────────────────────────
const FREE_NOISE_TAGS = ['script', 'style', 'noscript', 'iframe', 'svg', 'canvas'];

// ─── Advanced 추가 노이즈 태그 (Pro) ─────────────────────────────────────────
const ADVANCED_NOISE_TAGS = ['nav', 'footer', 'aside', 'header', 'form', 'dialog', 'menu'];

// ─── 노이즈 클래스/ID 패턴 (Advanced) ─────────────────────────────────────────
const NOISE_PATTERNS = [
  /class="[^"]*(?:nav|navbar|menu|sidebar|footer|header|cookie|banner|popup|overlay|advertisement|social|share|related|recommended|comment)[^"]*"/gi,
  /id="[^"]*(?:nav|navbar|menu|sidebar|footer|header|cookie|banner|popup|overlay|advertisement|social|share|related|recommended|comment)[^"]*"/gi,
];

/**
 * HTML 태그 제거 (중첩 태그 포함)
 */
function stripTag(html, tag) {
  // 중첩 태그를 위해 반복 적용
  let prev = '';
  let result = html;
  const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
  while (result !== prev) {
    prev = result;
    result = result.replace(regex, '');
  }
  return result;
}

/**
 * HTML 엔티티 디코딩
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&[a-zA-Z]+;/g, '');
}

/**
 * 인라인 태그 → Markdown 변환
 */
function convertInlineTags(text) {
  return text
    // Bold
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    // Italic
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    // Code
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    // Link
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const linkText = inner.replace(/<[^>]+>/g, '').trim();
      if (!linkText) return '';
      // 상대 URL은 그냥 텍스트만
      if (href.startsWith('#') || href.startsWith('javascript:')) return linkText;
      return `[${linkText}](${href})`;
    })
    // Strikethrough
    .replace(/<(?:s|del|strike)[^>]*>([\s\S]*?)<\/(?:s|del|strike)>/gi, '~~$1~~')
    // Mark / highlight
    .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '**$1**')
    // Remove remaining inline tags
    .replace(/<[^>]+>/g, '');
}

/**
 * 블록 수준 변환: pre/code
 */
function convertCodeBlocks(html) {
  return html.replace(/<pre[^>]*><code[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) => {
    const language = (lang || '').replace(/language-/i, '').split(' ')[0];
    const decoded = decodeHtmlEntities(code.replace(/<[^>]+>/g, ''));
    return `\n\`\`\`${language}\n${decoded}\n\`\`\`\n\n`;
  }).replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, content) => {
    const decoded = decodeHtmlEntities(content.replace(/<[^>]+>/g, ''));
    return `\n\`\`\`\n${decoded}\n\`\`\`\n\n`;
  });
}

/**
 * 블록 수준 변환: blockquote
 */
function convertBlockquotes(html) {
  return html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const text = content.replace(/<[^>]+>/g, '').trim();
    if (!text) return '';
    return '\n' + text.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
  });
}

/**
 * 블록 수준 변환: 테이블
 */
function convertTables(html) {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(tableContent)) !== null) {
      const cells = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
        const cellText = cellMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        cells.push(cellText);
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return '';

    let md = '\n';
    rows.forEach((row, i) => {
      md += '| ' + row.join(' | ') + ' |\n';
      if (i === 0) md += '| ' + row.map(() => '---').join(' | ') + ' |\n';
    });
    return md + '\n';
  });
}

/**
 * 메인 변환 함수
 * @param {string} html - 원본 HTML
 * @param {string} baseUrl - 원본 URL (제목 폴백용)
 * @param {{ advanced?: boolean, includeImages?: boolean }} options
 * @returns {string} 정제된 Markdown
 */
export function convertToCleanMarkdown(html, baseUrl, options = {}) {
  const { advanced = false, includeImages = true } = options;

  // ─── 1단계: 기본 노이즈 태그 제거 ─────────────────────────────────────────
  let clean = html;
  for (const tag of FREE_NOISE_TAGS) {
    clean = stripTag(clean, tag);
  }

  // Advanced: 추가 노이즈 태그 제거
  if (advanced) {
    for (const tag of ADVANCED_NOISE_TAGS) {
      clean = stripTag(clean, tag);
    }
    // 노이즈 클래스/ID를 가진 div, section 제거
    for (const pattern of NOISE_PATTERNS) {
      clean = clean.replace(/<(?:div|section|article)[^>]*>/gi, (match) => {
        if (pattern.test(match)) return '<_noise_>';
        pattern.lastIndex = 0;
        return match;
      });
    }
    // <_noise_> 태그 제거 (내용 포함)
    clean = clean.replace(/<_noise_>[\s\S]*?(?=<(?:div|section|article|p|h[1-6]|ul|ol|table)|$)/gi, '');
  }

  // 주석 제거
  clean = clean.replace(/<!--[\s\S]*?-->/g, '');

  // ─── 2단계: 메타 정보 추출 ─────────────────────────────────────────────────
  const titleMatch =
    clean.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
    clean.match(/<meta[^>]*name="title"[^>]*content="([^"]+)"/i) ||
    clean.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : new URL(baseUrl).hostname;

  const descMatch =
    clean.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) ||
    clean.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  const description = descMatch ? decodeHtmlEntities(descMatch[1].trim()) : null;

  // ─── 3단계: 본문 영역 추출 ─────────────────────────────────────────────────
  // <main>, <article>, [role=main] 우선, 없으면 body
  let body = '';
  const mainMatch =
    clean.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    clean.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    clean.match(/<[^>]*role="main"[^>]*>([\s\S]*?)<\/[^>]+>/i) ||
    clean.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  body = mainMatch ? mainMatch[1] : clean;

  // ─── 4단계: 블록 요소 변환 ─────────────────────────────────────────────────
  // 코드 블록 (인라인보다 먼저)
  body = convertCodeBlocks(body);

  // blockquote
  body = convertBlockquotes(body);

  // 테이블
  body = convertTables(body);

  // 수평선
  body = body.replace(/<hr[^>]*\/?>/gi, '\n---\n\n');

  // ─── 5단계: 헤딩 변환 ─────────────────────────────────────────────────────
  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi');
    body = body.replace(re, (_, content) => {
      const text = decodeHtmlEntities(convertInlineTags(content)).replace(/\s+/g, ' ').trim();
      return text ? `\n${'#'.repeat(i)} ${text}\n\n` : '';
    });
  }

  // ─── 6단계: 리스트 변환 ─────────────────────────────────────────────────────
  // 중첩 ul/ol 지원
  body = body.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    const items = [];
    content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, item) => {
      const text = decodeHtmlEntities(convertInlineTags(item)).replace(/\s+/g, ' ').trim();
      if (text) items.push(`- ${text}`);
    });
    return items.length ? '\n' + items.join('\n') + '\n\n' : '';
  });

  body = body.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    const items = [];
    let idx = 1;
    content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, item) => {
      const text = decodeHtmlEntities(convertInlineTags(item)).replace(/\s+/g, ' ').trim();
      if (text) items.push(`${idx++}. ${text}`);
    });
    return items.length ? '\n' + items.join('\n') + '\n\n' : '';
  });

  // ─── 7단계: 단락 변환 ─────────────────────────────────────────────────────
  body = body.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => {
    const text = decodeHtmlEntities(convertInlineTags(content)).replace(/\s+/g, ' ').trim();
    // 너무 짧은 단락 (광고 텍스트 등) 제거
    return text.length > 15 ? `${text}\n\n` : '';
  });

  // ─── 8단계: 이미지 처리 ───────────────────────────────────────────────────
  if (includeImages) {
    body = body.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, (_, alt, src) => {
      if (!alt.trim()) return '';
      return `![${alt.trim()}](${src})\n\n`;
    });
    body = body.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_, src, alt) => {
      if (!alt.trim()) return '';
      return `![${alt.trim()}](${src})\n\n`;
    });
  }
  // 이미지 태그 나머지 제거
  body = body.replace(/<img[^>]*\/?>/gi, '');

  // ─── 9단계: 남은 태그 제거 + 정리 ────────────────────────────────────────
  body = body.replace(/<[^>]+>/g, '');
  body = decodeHtmlEntities(body);

  // 과도한 공백/빈줄 정리
  body = body
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  // ─── 10단계: Markdown 조립 ────────────────────────────────────────────────
  let markdown = `# ${title}\n\n`;
  markdown += `*Source: ${baseUrl}*\n\n`;
  if (description) {
    markdown += `> ${description}\n\n`;
  }
  markdown += body;

  // 마무리 정리
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

  return markdown;
}

/**
 * 토큰 수 추정 (4글자 ≈ 1 토큰)
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * 원본 HTML 토큰 추정 (비교용)
 */
export function estimateOriginalTokens(html) {
  const stripped = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return Math.ceil(stripped.length / 4);
}
