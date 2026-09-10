/**
 * AZNP v2.2 - max_tokens 중요도 기반 압축 (마크다운 블록 스코어링)
 *
 * 기존의 단순 `chars*4` slice(문장/헤더 중간 절단)를 제거하고,
 * 마크다운을 최상위 블록 단위로 분할해 예산 내에서 앞쪽부터 보존한다.
 * - 첫 블록(H1 제목 · `*Source:*`)은 항상 유지 → H1이 잘리지 않음
 * - 본문 중간(문장/단어)을 자르지 않고 블록 경계에서 절단
 * - 파이프라인: 마크다운 생성 → truncate → format
 *
 * 토큰 추정은 `estimateTokens = ceil(len/4)` 를 따른다. (htmlToMarkdown.js)
 */

/** 최상위 블록 분할 (빈 줄 기준, fenced code block은 하나의 블록으로 유지) */
function splitTopLevelBlocks(markdown) {
  const lines = String(markdown).split('\n');
  const blocks = [];
  let cur = [];
  let inFence = false;

  const flush = () => {
    const text = cur.join('\n').trim();
    if (text) blocks.push(text);
    cur = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      cur.push(line);
      continue;
    }
    if (!inFence && line.trim() === '') {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();

  return blocks;
}

/**
 * max_tokens(토큰 예산) 내로 마크다운을 블록 경계에서 절단한다.
 * 예산 초과 시 뒤에 절단 안내문(`... (truncated by max_tokens)`)을 붙인다.
 */
export function truncateMarkdown(markdown, maxTokens) {
  if (!markdown) return markdown;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return markdown;

  // estimateTokens = ceil(len/4) 이므로 문자 예산 = maxTokens * 4
  const budgetChars = maxTokens * 4;
  const reserveChars = 48; // 절단 안내문 + 반올림 여유
  const limit = Math.max(budgetChars - reserveChars, 1);

  const blocks = splitTopLevelBlocks(markdown);
  if (blocks.length <= 1) return markdown;

  const kept = [];
  let used = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const isFirst = i === 0;
    if (!isFirst && used + block.length > limit) {
      break;
    }
    kept.push(block);
    used += block.length;
  }

  let result = kept.join('\n\n');
  if (kept.length < blocks.length) {
    result += '\n\n... (truncated by max_tokens)';
  }
  return result;
}
