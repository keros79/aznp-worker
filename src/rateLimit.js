/**
 * AZNP v2.1 - KV Sliding Window Rate Limiter
 * RPM (per minute) + RPD (per day) 두 단계 체크
 *
 * KV 키 구조:
 *   rl:rpm:<clientId>:<minuteSlot>  → 해당 분의 요청 수
 *   rl:rpd:<clientId>:<daySlot>     → 해당 날의 요청 수
 */

/**
 * 클라이언트 식별자 추출
 * - Pro: API Key
 * - Free: IP (CF-Connecting-IP)
 */
export function getClientId(request, planInfo) {
  if (planInfo.plan === 'pro' && planInfo.userId) {
    return `pro:${planInfo.userId}`;
  }
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
  return `free:${ip}`;
}

/**
 * Rate Limit 체크 (KV Sliding Window)
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
export async function checkRateLimit(request, env, planInfo) {
  if (!env.RESULTS_KV) {
    // KV 없으면 rate limit 생략 (개발 환경)
    return { allowed: true, remaining: planInfo.limits.rpm - 1, resetIn: 60 };
  }

  const clientId = getClientId(request, planInfo);
  const now = Date.now();
  const minuteSlot = Math.floor(now / 60_000); // 현재 분 슬롯
  const daySlot = Math.floor(now / 86_400_000); // 현재 일 슬롯

  const rpmKey = `rl:rpm:${clientId}:${minuteSlot}`;
  const rpdKey = `rl:rpd:${clientId}:${daySlot}`;

  try {
    // RPM + RPD 병렬 조회
    const [rpmRaw, rpdRaw] = await Promise.all([
      env.RESULTS_KV.get(rpmKey),
      env.RESULTS_KV.get(rpdKey),
    ]);

    const rpmCount = parseInt(rpmRaw || '0', 10);
    const rpdCount = parseInt(rpdRaw || '0', 10);

    const { rpm, rpd } = planInfo.limits;

    // 초과 여부 확인
    if (rpmCount >= rpm) {
      const resetIn = 60 - Math.floor((now % 60_000) / 1000);
      return { allowed: false, remaining: 0, resetIn, reason: 'rpm' };
    }
    if (rpdCount >= rpd) {
      const resetIn = 86400 - Math.floor((now % 86_400_000) / 1000);
      return { allowed: false, remaining: 0, resetIn, reason: 'rpd' };
    }

    // 카운터 증가 (waitUntil과 별도로 즉시 처리)
    const newRpm = rpmCount + 1;
    const newRpd = rpdCount + 1;

    // TTL: RPM은 2분(여유), RPD는 25시간(여유)
    await Promise.all([
      env.RESULTS_KV.put(rpmKey, String(newRpm), { expirationTtl: 120 }),
      env.RESULTS_KV.put(rpdKey, String(newRpd), { expirationTtl: 90_000 }),
    ]);

    return {
      allowed: true,
      remaining: Math.min(rpm - newRpm, rpd - newRpd),
      resetIn: 60 - Math.floor((now % 60_000) / 1000),
    };
  } catch (e) {
    // KV 오류 시 허용 (가용성 우선)
    console.error('[RateLimit] KV error:', e.message);
    return { allowed: true, remaining: planInfo.limits.rpm - 1, resetIn: 60 };
  }
}
