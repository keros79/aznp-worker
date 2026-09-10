import { serializeResponse, ALLOWED_FORMATS, contentTypeFor } from './src/formatters.js';
import { truncateMarkdown } from './src/truncate.js';

const out = [];
const check = (name, cond, extra = '') => {
  out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  | ' + extra : ''}`);
};

// 1. 포맷 직렬화
const md = '# Title here\n\n*Source: https://example.com*\n\nFirst paragraph with some content.\n\n## Section Two\n\nMore content here for tests.\n\n```js\nconst a = 1;\n```\n';
for (const fmt of ALLOWED_FORMATS) {
  const r = serializeResponse(md, {
    format: fmt, plan: 'pro', source: 'aznp-self',
    targetUrl: 'https://example.com', tokenEstimate: 100, originalTokenEstimate: 500,
  });
  check(`${fmt} serialize -> ${r.contentType}`, typeof r.body === 'string' && r.body.length > 10, fmt);
}
const toml = serializeResponse(md, { format: 'toml', plan: 'pro', targetUrl: 'https://x.com' }).body;
check('toml has content=""', toml.includes('content = """') && toml.includes('title = "Title here"'));
const yaml = serializeResponse(md, { format: 'yaml', plan: 'pro', targetUrl: 'https://x.com' }).body;
check('yaml has literal block', yaml.includes('content: |') && yaml.includes('title: "Title here"'));
const jld = JSON.parse(serializeResponse(md, { format: 'json-ld', plan: 'pro', targetUrl: 'https://x.com' }).body);
check('json-ld @type Article', jld['@type'] === 'Article' && jld['@context'].includes('schema.org'));
const json = JSON.parse(serializeResponse(md, { format: 'json', plan: 'pro', targetUrl: 'https://x.com', tokenEstimate: 12, originalTokenEstimate: 50, tokenReduction: '70%', source: 'aznp-self' }).body);
check('json compatibility shape', json.title === 'Title here' && json.source === 'https://x.com' && json.meta.tokens === 12 && json.meta.token_reduction === '70%');

// 2. truncate
const long = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\nParagraph ${i} with enough words to fill a block.`).join('\n\n');
const short = truncateMarkdown(long, 200);
check('truncate: estimate <= 200', Math.ceil(short.length / 4) <= 200, `len=${short.length} est=${Math.ceil(short.length / 4)}`);
check('truncate: keeps first heading', short.startsWith('## Section 0'));
check('truncate: adds marker', short.includes('truncated by max_tokens'));
const h1keep = truncateMarkdown('# Keep Me\n\nAaa bbb ccc.\n\nBbb ccc ddd.', 5);
check('truncate: tiny budget still keeps H1', h1keep.startsWith('# Keep Me'));
check('truncate: zero is passthrough', truncateMarkdown('# x', 0) === '# x');

console.log(out.join('\n'));
console.log(`\nTotal: ${out.filter((x) => x.startsWith('PASS')).length}/${out.length}`);
if (out.some((x) => x.startsWith('FAIL'))) process.exit(1);