# AZNP Worker 개발 규칙

이 프로젝트는 **Agentic Zero-Noise Proxy (AZNP) v2.1** Cloudflare Worker입니다.
코드 작업 시 아래 규칙을 **반드시** 준수하고, 상세 스펙은 [`AZNP_Final_Design.md`](../AZNP_Final_Design.md)를 참조하라.

---

## 아키텍처 규칙

- **다층 캐시 순서를 반드시 유지한다**: Cache API (L1) → KV (L2) → 실제 변환 (L3)
- 캐시 히트 시 즉시 반환하고, 불필요한 변환은 절대 실행하지 않는다.
- Tier 변환 우선순위를 유지한다: **Tier 1 (CF Native) → Tier 2 (자체 변환) → Tier 3 (Browser Rendering)**

## 플랜 권한 규칙

- `FREE_LIMITS`와 `PRO_LIMITS` 상수는 설계서 섹션 3 기준으로 유지한다.
  - Free: `allowRender: false`, `allowSummary: false`, `allowStructured: false`, `advancedExtraction: false`
  - Pro: 위 항목 모두 `true`
- Pro 전용 기능(`render`, `summary`, `json format`) 요청 시 권한 없으면 **조기 차단(403)**으로 CPU를 절약한다.
- Rate Limit: Free `15 RPM / 1,000 RPD`, Pro `120 RPM / 20,000 RPD`

## 금지 사항

- **`npx wrangler deploy` 등의 배포 명령어는 자동 실행하지 않는다.** (사용자가 명시적으로 "배포", "deploy"를 요청/승인했을 때만 진행한다.)
- **다중 Cloudflare 무료 계정 운영은 절대 권장하지 않는다** (ToS 위반 + 운영 복잡도).
- 트래픽 증가 시 Workers Paid ($5/월) 전환을 권장한다.
- `forceFresh` 없이 캐시를 우회하는 로직을 추가하지 않는다.

## 바인딩 규칙

| 바인딩 이름 | 타입 | 용도 |
|-------------|------|------|
| `API_KEYS` | KV Namespace | Pro API Key 인증 |
| `RESULTS_KV` | KV Namespace | L2 변환 결과 캐시 |
| `DB` | D1 Database | Pro 사용량·토큰 통계 |
| `BROWSER` | Browser Rendering | Tier 3 (Pro 전용) |

## 개발 시 확인 사항

- 새 기능 추가 전 **설계서 섹션 10 (로드맵)**과 일치 여부를 확인한다.
- D1 통계 기록은 `ctx.waitUntil()`로 비동기 처리하여 응답 지연 없이 동작해야 한다.
- API Key 형식: `aznp_pro_<random_32_chars>`
- 결제 연동은 **Stripe / Lemon Squeezy Webhook → KV 상태 업데이트** 방식으로 한다.
