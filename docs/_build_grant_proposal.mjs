import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'AZNP_Solana_Foundation_Grant_Proposal.docx');

const NAVY = '1B4F72';
const TEAL = '0E6655';
const RULE = '1B4F72';
const HAIR = 'CCCCCC';
const HEAD_BG = 'D6EAF8';
const NOTE_BG = 'F4F6F7';
const WHITE = 'FFFFFF';
const PAGE_W = 12240;
const PAGE_H = 15840;
const MARGIN = 1080;
const CONTENT_W = PAGE_W - MARGIN * 2; // 10080

const border = { style: BorderStyle.SINGLE, size: 4, color: HAIR };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: WHITE },
  bottom: { style: BorderStyle.NONE, size: 0, color: WHITE },
  left: { style: BorderStyle.NONE, size: 0, color: WHITE },
  right: { style: BorderStyle.NONE, size: 0, color: WHITE },
};

const cellPad = { top: 80, bottom: 80, left: 120, right: 120 };

function run(text, opts = {}) {
  return new TextRun({
    text,
    font: 'Arial',
    size: opts.size ?? 22,
    bold: !!opts.bold,
    italics: !!opts.italics,
    color: opts.color,
    underline: opts.underline ? {} : undefined,
  });
}

function p(children, opts = {}) {
  const content = typeof children === 'string' ? [run(children, opts.run || {})] : children;
  return new Paragraph({
    spacing: { before: opts.before ?? 60, after: opts.after ?? 120, line: 276 },
    alignment: opts.align,
    numbering: opts.numbering,
    border: opts.border,
    shading: opts.shading,
    indent: opts.indent,
    children: content,
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: RULE, space: 4 } },
    spacing: { before: 360, after: 160 },
    children: [run(text, { bold: true, size: 28, color: NAVY })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [run(text, { bold: true, size: 24, color: TEAL })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [run(text, { bold: true, size: 22, color: NAVY })],
  });
}

function link(label, url) {
  return new ExternalHyperlink({
    children: [run(label, { color: '0563C1', underline: true, size: 22 })],
    link: url,
  });
}

function mixed(parts, opts = {}) {
  const children = parts.map((part) => {
    if (typeof part === 'string') return run(part, part.startsWith('http') ? {} : {});
    if (part.href) return link(part.text, part.href);
    return run(part.text, part);
  });
  return p(children, opts);
}

function bullet(text, ref = 'bullets') {
  return p(typeof text === 'string' ? [run(text)] : text, {
    numbering: { reference: ref, level: 0 },
    before: 40,
    after: 60,
  });
}

function cell(width, children, opts = {}) {
  const paras = Array.isArray(children)
    ? children
    : [p(typeof children === 'string' ? children : children, { before: 40, after: 40 })];
  return new TableCell({
    borders: opts.borders ?? borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    margins: cellPad,
    verticalAlign: opts.valign ?? VerticalAlign.TOP,
    columnSpan: opts.span,
    children: paras,
  });
}

function headerCell(width, text) {
  return cell(width, [p([run(text, { bold: true, size: 18, color: NAVY })], { before: 40, after: 40 })], {
    fill: HEAD_BG,
    valign: VerticalAlign.CENTER,
  });
}

function dataCell(width, text, opts = {}) {
  const content =
    typeof text === 'string'
      ? [p([run(text, { size: opts.size ?? 18, bold: !!opts.bold })], { before: 40, after: 40 })]
      : text;
  return cell(width, content, opts);
}

function table(colWidths, rows) {
  const width = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: width, type: WidthType.DXA },
    columnWidths: colWidths,
    rows,
  });
}

function spacer(after = 80) {
  return p('', { before: 0, after });
}

const W2 = [2800, CONTENT_W - 2800];
const W4 = [720, 2520, 5160, 1680]; // 10080

function kvRow(label, valueParas) {
  return new TableRow({
    children: [
      cell(W2[0], [p([run(label, { bold: true, size: 20 })], { before: 40, after: 40 })], { fill: HEAD_BG }),
      cell(W2[1], Array.isArray(valueParas) ? valueParas : [p(valueParas, { before: 40, after: 40 })]),
    ],
  });
}

const children = [
  p([run('Solana Foundation', { bold: true, size: 20, color: TEAL })], { before: 0, after: 40 }),
  p([run('Developer Tooling Grant Proposal', { bold: true, size: 40, color: NAVY })], { before: 0, after: 80 }),
  p(
    [run('AZNP MCP Server — Agentic Zero-Noise Proxy for Solana AI Agents', { italics: true, size: 22, color: '34495E' })],
    { before: 0, after: 80 },
  ),
  p(
    [
      run('Prepared by kerberos  ·  ', { size: 18, color: '5D6D7E' }),
      run(new Date().toISOString().slice(0, 10), { size: 18, color: '5D6D7E' }),
      run('  ·  Total requested: $20,000 USD', { size: 18, color: '5D6D7E' }),
    ],
    { before: 0, after: 200 },
  ),

  // ─── 1 ───
  h1('1. Applicant Information'),

  table(W2, [
    kvRow('Project / Tool Name', [p([run('AZNP MCP Server', { bold: true }), run(' (Agentic Zero-Noise Proxy)')], { before: 40, after: 40 })]),
    kvRow('Applicant / Organization', 'kerberos (individual)'),
    kvRow('Primary Contact', [
      p(
        [
          run('kerberos — kerberos79@gmail.com — GitHub '),
          link('@keros79', 'https://github.com/keros79'),
        ],
        { before: 40, after: 40 },
      ),
    ]),
    kvRow('Total Amount Requested (USD)', [p([run('$20,000', { bold: true, size: 22 })], { before: 40, after: 40 })]),
    kvRow('Funding track', [
      p(
        [run('Standard grant', { bold: true }), run(' — non-commercial public good. Not a convertible grant. MCP server, tool schemas, SDKs, and plugins are MIT and free to run forever. No paid credits, subscriptions, or API-key paywall in this grant.')],
        { before: 40, after: 40 },
      ),
    ]),
  ]),

  h2('Relevant Experience & Track Record'),
  p('I design, ship, and operate AZNP, a live Cloudflare Workers edge proxy that converts noisy HTML into clean Markdown for AI agents. The current proof-of-concept already includes:'),
  bullet('Solana-native stateless identity: Ed25519 verification of x402:{timestamp} using tweetnacl + bs58. The wallet is the caller ID. No API-key database.'),
  bullet('HTML-to-Markdown conversion with optional TOML / YAML / JSON serializers, Cache API + KV, and automated auth/integration tests.'),
  bullet('Open-source Worker under MIT (LICENSE in the repository).'),
  mixed([
    { text: 'This grant does not pay to start that Worker from scratch, and it does not fund a paid credit product. The Worker is the edge backend. Grant-funded work is the missing public-good layer: an official MCP server, client SDKs, and Solana agent-framework plugins — all free, MIT, and runnable by anyone.' },
  ]),
  mixed([
    { text: 'Proof-of-concept repository: ' },
    { text: 'github.com/keros79/aznp-worker', href: 'https://github.com/keros79/aznp-worker' },
  ]),
  mixed([
    { text: 'Live Worker health check: ' },
    { text: 'aznp-proxy.kerberos79.workers.dev/health', href: 'https://aznp-proxy.kerberos79.workers.dev/health' },
  ]),

  // ─── 2 ───
  h1('2. Overview of Ecosystem Impact'),
  p('AZNP MCP Server is a standard-grant public good: MIT-licensed, free to install, free to call. There is no credit pack, no monthly subscription, and no API-key paywall in the grant product. Anyone can run npx @aznp/mcp-server, inspect the code, or point agents at the public endpoint.'),

  h2('How is this project a public good for the Solana community?'),
  p('Solana AI agents — Eliza OS characters, Solana Agent Kit workflows, and Claude/Cursor sessions connected over MCP — constantly fetch web documentation, GitHub READMEs, program specs, and RPC references. Raw HTML burns context window and inference budget. Today each team writes a one-off scraper or depends on a proprietary, API-key-gated proxy that does not speak Solana identity.'),
  p('The public good this grant funds is one shared, free agent interface: a published MCP server that any Solana developer can install with npx, wire into Claude Desktop or Cursor, or embed in Eliza / Agent Kit, using the same Solana keypair the agent already holds. No paid credits. One open tool replaces N private scrapers.'),

  h2('Specific benefits to Solana developers'),
  bullet('One free MCP tool (convert_url) instead of ad-hoc fetch-and-parse in every agent. Output: Markdown by default, plus TOML / YAML / JSON for structured pipelines. All formats are in the public offering.'),
  bullet('Identity is a Solana keypair. Agents that already hold a wallet do not need to store an AZNP API key. The server never receives the secret key — only a detached Ed25519 signature. Unsigned calls still work; the signature is how Solana agents identify themselves without a vendor account.'),
  bullet('Lower token cost when agents read Solana docs, Anchor/program READMEs, and HTTP specs. The existing edge engine strips nav/ads/scripts before the model sees the page.'),
  bullet('First-party Eliza OS plugin and Solana Agent Kit tool, MIT, so framework users add AZNP in configuration rather than hand-rolling signed HTTP.'),

  // ─── 3 ───
  h1('3. Product Design'),
  p('A working edge proof-of-concept already exists. The build process for this grant is: keep the Worker as a free public backend, implement the MCP server and SDKs against that API, deploy them publicly under MIT, then add Solana framework plugins. Paid credits, subscriptions, and non-Solana chains are out of scope.'),

  h2('Why Solana — not possible elsewhere'),
  p('This is the center of the proposal. AZNP is not a generic web scraper that happens to run on Cloudflare. The grant product exists because Solana agents already have a keypair and already live inside Solana-native runtimes.'),
  bullet('Same keypair, no vendor account. Eliza OS and Solana Agent Kit agents hold a Solana secret key to sign transactions. AZNP reuses that key for Ed25519 request identity (message x402:{timestamp}). A hosted markdown API on Ethereum, Base, or a centralized API-key SaaS cannot do this without introducing a second identity system. The Solana wallet is the account.'),
  bullet('Solana agent runtimes, not a chain-agnostic chatbot. The plugins target Eliza OS and Solana Agent Kit — the two runtimes Solana developers actually wire to on-chain actions. convert_url sits next to swap/transfer tools and shares the same signer.'),
  bullet('Cheap, stateless verify on the edge. Detached Ed25519 verify (tweetnacl) is the auth primitive. There is no OAuth app, no API-key KV of customers, and no credit ledger in this grant. That matches how Solana agents already authenticate: sign a message, prove a pubkey.'),
  bullet('Out of scope on purpose. Base / EVM signatures, USDC credit packs, Lemon Squeezy, and 402 paywalls are not part of this grant. They are not needed for the public good and would make this a commercial product. The Foundation is asked to fund a free Solana agent tool, not a billing system.'),
  p('If this were only “HTML to Markdown,” it would belong on any cloud. The Solana-only piece is wallet-native identity plus first-party hooks into the Solana agent stack, shipped as free MCP.'),

  h2('Architecture & how it works'),
  p([run('Request path (grant product):', { bold: true })]),
  p('Claude Desktop / Cursor / Eliza OS / Solana Agent Kit  →  MCP (stdio or remote)  →  @aznp/mcp-server  →  optional Solana Ed25519 headers  →  existing AZNP Cloudflare Worker  →  target URL converted to clean Markdown (or TOML / YAML / JSON). Convert is free with or without a signature.'),
  p([run('Existing backend (proof-of-concept, already deployed):', { bold: true })]),
  p('Cloudflare Worker with Cache API (L1) + KV (L2), HTML-to-Markdown conversion, optional structured serializers, and Solana Ed25519 verify. Grant work treats this Worker as a stable, free backend. Worker changes during the grant are limited to MCP-required API compatibility (for example a public metrics endpoint and keeping convert ungated). This grant does not rebuild the HTML parser and does not ship a paywall.'),
  p([run('Grant-funded layer (to be implemented and deployed):', { bold: true })]),
  p('@aznp/mcp-server implements MCP initialize / list_tools / call_tool. Tools map to Worker routes. The TypeScript and Python SDKs optionally sign x402:{timestamp} with a Solana keypair and attach x-wallet-address, x-signature, and x-timestamp. Eliza and Agent Kit packages call the MCP server or SDK. Deployment is npm + a public remote MCP endpoint. All of it is MIT and free.'),

  h2('Key features'),
  bullet('Official MCP server: convert_url (markdown / toml / yaml / json) and health. No payment-required tool and no credit balance.'),
  bullet('Stdio transport (npx @aznp/mcp-server) for Claude Desktop and Cursor, plus a publicly deployed remote MCP endpoint.'),
  bullet('TypeScript and Python SDKs that perform Solana Ed25519 request signing. Sub-millisecond applies to detached signature verification on the edge (tweetnacl), not to KV lookups or network RTT. Signing is identity, not billing.'),
  bullet('First-party Eliza OS plugin and Solana Agent Kit tool, MIT.'),
  bullet('Open-source docs: MCP tool schemas, signing message format, and a public demo walkthrough.'),

  h2('Integration into existing developer workflows'),
  bullet('Claude Desktop / Cursor: add AZNP to mcp.json and run npx -y @aznp/mcp-server. The agent calls convert_url like any other MCP tool.'),
  bullet('Eliza OS: enable the AZNP plugin in the character file so the runtime can fetch clean page context during tool use.'),
  bullet('Solana Agent Kit: register the AZNP tool next to existing kit actions; agents that already sign Solana transactions reuse the same keypair for AZNP headers.'),
  bullet('Direct HTTP remains available for non-MCP clients (the existing Worker). The MCP server is the supported path for agent tooling.'),

  h2('Technology stack'),
  table(
    [3200, CONTENT_W - 3200],
    [
      new TableRow({
        children: [headerCell(3200, 'Layer'), headerCell(CONTENT_W - 3200, 'Stack')],
      }),
      new TableRow({
        children: [
          dataCell(3200, 'MCP server (grant build)', { bold: true }),
          dataCell(CONTENT_W - 3200, 'TypeScript, @modelcontextprotocol/sdk, stdio + remote/SSE, npm package @aznp/mcp-server'),
        ],
      }),
      new TableRow({
        children: [
          dataCell(3200, 'Client SDKs (grant build)', { bold: true }),
          dataCell(CONTENT_W - 3200, 'TypeScript (@aznp/sdk) and Python (aznp). Ed25519 via tweetnacl / PyNaCl. No @solana/web3.js required for signing.'),
        ],
      }),
      new TableRow({
        children: [
          dataCell(3200, 'Framework plugins (grant build)', { bold: true }),
          dataCell(CONTENT_W - 3200, 'Eliza OS plugin and Solana Agent Kit tool, published as first-party packages'),
        ],
      }),
      new TableRow({
        children: [
          dataCell(3200, 'Edge backend (existing PoC)', { bold: true }),
          dataCell(CONTENT_W - 3200, 'JavaScript Cloudflare Workers, Wrangler, tweetnacl, bs58, Cache API, KV, D1. Live at aznp-proxy.kerberos79.workers.dev'),
        ],
      }),
      new TableRow({
        children: [
          dataCell(3200, 'Identity (existing PoC)', { bold: true }),
          dataCell(CONTENT_W - 3200, 'Solana Ed25519 (tweetnacl / bs58). Optional request headers; convert is free without them. No credit ledger in this grant.'),
        ],
      }),
    ],
  ),

  h2('Proof-of-Concept (optional)'),
  mixed([
    { text: 'Repository (open source): ' },
    { text: 'https://github.com/keros79/aznp-worker', href: 'https://github.com/keros79/aznp-worker' },
  ]),
  mixed([
    { text: 'Live edge health: ' },
    { text: 'https://aznp-proxy.kerberos79.workers.dev/health', href: 'https://aznp-proxy.kerberos79.workers.dev/health' },
  ]),
  p('The Worker already converts pages and verifies Solana signatures. It is the PoC. Convert in this grant is a free public good (no credits). The MCP server, SDKs, and plugins named in Section 4 are not in that repository yet; they are the grant deliverables to implement and deploy under MIT.'),

  // ─── 4 ───
  h1('4. Budget Breakdown (Milestones)'),
  p(
    [
      run('Scope of this grant. ', { bold: true }),
      run(
        'Milestones fund implementation and public deployment of the AZNP MCP server and its client packages as a free, MIT public good. They are not a request to begin additional Worker-feature development, and they are not a request to build billing. The live Cloudflare Worker remains the free edge backend. During the grant, Worker changes are limited to MCP compatibility, keeping convert ungated, and a public metrics endpoint. Primary engineering is MCP server, SDKs, plugins, npm/PyPI publish, and a public MCP endpoint. Base/EVM and paid credits are out of scope.',
      ),
    ],
    {
      shading: { type: ShadingType.CLEAR, fill: NOTE_BG },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: TEAL, space: 8 } },
      indent: { left: 120, right: 120 },
      before: 80,
      after: 200,
    },
  ),
  p('Total requested: $20,000 USD, split as $14,000 beta components + $3,000 maintenance + $3,000 user adoption.'),

  h2('4a. Completed First Version (Beta) — per component'),
  p('Each component below is a working prototype of that package, paid upon completion. Together they are the first published MCP product, not a continuation of internal Worker checklists.'),

  h3('Component 1: Official @aznp/mcp-server — $5,000'),
  p([run('Beta scope. ', { bold: true }), run('Publish @aznp/mcp-server on npm. Ship a stdio MCP server runnable via npx -y @aznp/mcp-server and a publicly deployed remote MCP endpoint. Tools: convert_url (markdown default; toml / yaml / json options) and health. All tools are free; there is no payment-required tool and no credit balance. The server wraps the existing AZNP Worker; this component does not rebuild the HTML parser.')]),
  p([run('Testing plan. ', { bold: true }), run('MCP initialize / list_tools / call_tool contract tests. convert_url against a fixed fixture list (static HTML fixture, a public Solana docs page, a GitHub README) with schema and non-empty Markdown checks, including unsigned (anonymous) convert. Publish a recorded Claude Desktop or Cursor walkthrough with the release; GUI automation is not the pass gate. Automated tests run in CI on the MCP package.')]),

  h3('Component 2: TypeScript & Python SDKs with Solana Ed25519 signing — $6,000'),
  p([run('Beta scope. ', { bold: true }), run('Publish @aznp/sdk (npm) and aznp (PyPI). Each SDK loads a Solana keypair, signs message x402:{timestamp}, and attaches x-wallet-address, x-signature, and x-timestamp when calling the MCP server or the Worker. The secret key never leaves the client. Edge verification remains tweetnacl (already in the PoC). Documentation states that “sub-millisecond” refers to detached Ed25519 verify on the Worker CPU, not end-to-end KV or network latency.')]),
  p([run('Testing plan. ', { bold: true }), run('Generated keypair sign → SDK request → Worker or mock verifier round-trip. Reject expired timestamps, wrong message prefix, and mismatched public keys. TypeScript and Python emit the same header values for the same key and timestamp. Integration test against the public Worker /health and one convert call. No Claude/Cursor UI harness required for this component.')]),

  h3('Component 3: Eliza OS plugin & Solana Agent Kit tool — $3,000'),
  p([run('Beta scope. ', { bold: true }), run('First-party packages: an Eliza OS plugin and a Solana Agent Kit tool that call @aznp/mcp-server or the SDK. README plus a public demo walkthrough on live infrastructure (Worker + MCP endpoint). Upstream pull requests into Eliza or Agent Kit core are best-effort and are not a payment gate — completion is the first-party packages working against the public MCP server.')]),
  p([run('Testing plan. ', { bold: true }), run('Plugin/tool unit tests (schema load, signed convert call against mock MCP). Live workflow execution recorded as a public demo (agent fetches a docs URL via AZNP and uses the Markdown).')]),

  h2('4b. Maintenance — minimum 6 months'),
  p([run('Total maintenance budget: $3,000 USD', { bold: true }), run(' ($500 USD per month for 6 months). Each month is a milestone, paid as a 1-month portion of this budget.')]),
  p('Maintenance includes, to the Foundation’s satisfaction:'),
  bullet('Managing GitHub issues and fixing bug reports on the MCP server, SDKs, plugins, and the edge API they call.'),
  bullet('Upgrading MCP SDK dependencies (@modelcontextprotocol/sdk) and signing libraries (tweetnacl / bs58 / PyNaCl) — not Solana Web3.js, which this stack does not use for verify or sign.'),
  bullet('Keeping the public MCP endpoint and the existing Worker deployment available (convert remains free).'),
  bullet('Compatibility fixes when Eliza OS or Solana Agent Kit plugin APIs drift.'),
  bullet('Documentation updates for tool schemas and signing.'),

  h2('4c. User Adoption'),
  p([run('Total user-adoption budget: $3,000 USD.', { bold: true }), run(' Each metric is its own milestone. For every 25% of a metric’s target reached, 25% of that metric’s budget is paid at period end. Integrations are counted as whole numbers (see rounding below).')]),

  h3('Metric 1: Framework & project integrations — $1,500'),
  p([run('Target: ', { bold: true }), run('3 active Solana AI frameworks or developer tools integrated with AZNP MCP (for example: the Eliza OS plugin, the Solana Agent Kit tool, and a third public consumer such as a published agent repo, an additional framework adapter, or a listed MCP client config in a public project).')]),
  p([run('Tracking: ', { bold: true }), run('Public GitHub repositories and package manifests that depend on @aznp/mcp-server, @aznp/sdk, the Eliza plugin, or the Agent Kit tool. Merged upstream PRs are supporting evidence, not required.')]),
  p([run('Disbursement: ', { bold: true }), run('1 public integration = 25% ($375). 2 = 50% ($750). 3 = 100% ($1,500). The 75% tranche is paid together with 100% when the third integration is public, so amounts stay in whole integrations.')]),

  h3('Metric 2: Active developer / agent usage — $1,500'),
  p([run('Target: ', { bold: true }), run('50 unique daily callers (unique Solana wallet or hashed MCP client id, measured as a 7-day peak daily unique count) or 100,000 cumulative convert requests through the MCP server and Worker, whichever is reached first.')]),
  p([run('Tracking: ', { bold: true }), run('A public JSON metrics endpoint on the Worker (aggregate request counts and unique-caller counts — not a private Cloudflare dashboard and not raw wallet lists). Weekly snapshots committed or linked from the repo. Automated self-traffic from the maintainer is excluded from unique-caller counts.')]),
  p([run('Disbursement (25% increments): ', { bold: true }), run('25% = 13 unique daily or 25,000 requests ($375). 50% = 25 unique daily or 50,000 requests ($750). 75% = 38 unique daily or 75,000 requests ($1,125). 100% = 50 unique daily or 100,000 requests ($1,500).')]),

  h2('Milestone Summary Table'),
  p('Amounts sum to the Total Amount Requested ($20,000). Maintenance is six monthly milestones of $500, shown as one row for readability; each month is still payable on its own.'),

  table(W4, [
    new TableRow({
      children: [
        headerCell(W4[0], '#'),
        headerCell(W4[1], 'Milestone / Deliverable'),
        headerCell(W4[2], 'Success Criteria'),
        headerCell(W4[3], 'Amount (USD)'),
      ],
    }),
    new TableRow({
      children: [
        dataCell(W4[0], '1'),
        dataCell(W4[1], '@aznp/mcp-server beta (Component 1)'),
        dataCell(W4[2], 'npm package published; stdio + public remote MCP; convert_url / health tools pass contract tests against the existing Worker; recorded client walkthrough published.'),
        dataCell(W4[3], '$5,000', { bold: true }),
      ],
    }),
    new TableRow({
      children: [
        dataCell(W4[0], '2'),
        dataCell(W4[1], 'TS & Python SDKs + Ed25519 signing (Component 2)'),
        dataCell(W4[2], '@aznp/sdk and aznp published; sign/verify round-trip tests pass; expired/wrong-key cases rejected; headers work against live Worker.'),
        dataCell(W4[3], '$6,000', { bold: true }),
      ],
    }),
    new TableRow({
      children: [
        dataCell(W4[0], '3'),
        dataCell(W4[1], 'Eliza OS plugin & Solana Agent Kit tool (Component 3)'),
        dataCell(W4[2], 'First-party packages released; unit tests pass; public live demo of an agent calling AZNP MCP.'),
        dataCell(W4[3], '$3,000', { bold: true }),
      ],
    }),
    new TableRow({
      children: [
        dataCell(W4[0], '4'),
        dataCell(W4[1], 'Maintenance (months 1–6)'),
        dataCell(W4[2], 'Each month: issues/bugs addressed, MCP and signing dependencies kept current, public MCP + Worker available. Paid $500 per month.'),
        dataCell(W4[3], '$3,000', { bold: true }),
      ],
    }),
    new TableRow({
      children: [
        dataCell(W4[0], '5'),
        dataCell(W4[1], 'Adoption — 3 framework / project integrations'),
        dataCell(W4[2], '1 / 2 / 3 public integrations → $375 / $750 / $1,500. Tracked via public repos and package manifests.'),
        dataCell(W4[3], '$1,500', { bold: true }),
      ],
    }),
    new TableRow({
      children: [
        dataCell(W4[0], '6'),
        dataCell(W4[1], 'Adoption — 50 unique daily callers or 100k requests'),
        dataCell(W4[2], '25% increments via public metrics endpoint (13 / 25 / 38 / 50 unique daily, or 25k / 50k / 75k / 100k requests).'),
        dataCell(W4[3], '$1,500', { bold: true }),
      ],
    }),
    new TableRow({
      children: [
        cell(
          W4[0] + W4[1] + W4[2],
          [p([run('Total (must match Total Amount Requested)', { bold: true, size: 18 })], { before: 40, after: 40 })],
          { fill: HEAD_BG, span: 3 },
        ),
        cell(W4[3], [p([run('$20,000', { bold: true, size: 20, color: NAVY })], { before: 40, after: 40 })], { fill: HEAD_BG }),
      ],
    }),
  ]),

  // ─── 5 ───
  h1('5. Acknowledgements'),
  p('Confirm each requirement:'),
  spacer(40),
  table(
    [CONTENT_W - 1800, 1800],
    [
      new TableRow({
        children: [headerCell(CONTENT_W - 1800, 'Requirement'), headerCell(1800, 'Confirm')],
      }),
      new TableRow({
        children: [
          dataCell(CONTENT_W - 1800, 'The project will release a published production version by the end of the grant agreement.'),
          dataCell(1800, 'Yes', { bold: true }),
        ],
      }),
      new TableRow({
        children: [
          dataCell(CONTENT_W - 1800, 'The project will be completely public and open-source.'),
          dataCell(1800, 'Yes', { bold: true }),
        ],
      }),
      new TableRow({
        children: [
          dataCell(CONTENT_W - 1800, 'The team agrees to at least 6 months of maintenance.'),
          dataCell(1800, 'Yes', { bold: true }),
        ],
      }),
      new TableRow({
        children: [
          dataCell(CONTENT_W - 1800, 'The team agrees to meet quantifiable user-adoption metrics.'),
          dataCell(1800, 'Yes', { bold: true }),
        ],
      }),
    ],
  ),
  spacer(200),
  p(
    [
      run('End of proposal.  ', { italics: true, size: 18, color: '5D6D7E' }),
      run('Grey template instructions were removed and all bracketed fields filled. Primary grant work is MCP server implementation and deployment, using the existing AZNP Worker as the proof-of-concept backend.', {
        italics: true,
        size: 18,
        color: '5D6D7E',
      }),
    ],
    { before: 120, after: 0 },
  ),
];

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 22 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: NAVY },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: TEAL },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial', color: NAVY },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              border: { top: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 8 } },
              spacing: { before: 120 },
              children: [
                run('AZNP MCP Server  ·  Solana Foundation Developer Tooling Grant  ·  Page ', {
                  size: 16,
                  color: '5D6D7E',
                }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: '5D6D7E' }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(OUT, buf);
console.log('Wrote', OUT, 'bytes=', buf.length);
