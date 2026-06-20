/**
 * 안심상속 v2: 전문가 - 매칭된 상담 요청 목록 조회
 * GET /api/expert-requests?token=xxx
 *
 * access_token으로 간이 인증 (별도 로그인 시스템 없이 매직링크 방식)
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ ok: false, message: '접근 토큰이 필요합니다.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase 환경변수 누락');
    }

    const headers = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    };

    /* 1. 토큰으로 전문가 조회 */
    const expertRes = await fetch(`${SUPABASE_URL}/rest/v1/experts?access_token=eq.${token}&select=*`, { headers });
    if (!expertRes.ok) throw new Error('전문가 조회 실패');
    const experts = await expertRes.json();
    const expert = experts[0];

    if (!expert) {
      return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });
    }
    if (expert.subscription_status !== 'active') {
      return res.status(200).json({ ok: true, expert, requests: [], notice: '구독이 활성화되지 않아 요청을 볼 수 없습니다. 안심상속에 문의해주세요.' });
    }

    /* 2. 전문가 specialties와 겹치는 open 요청 조회 (전체 open 요청 가져온 뒤 서버에서 필터링 — 소규모 MVP 기준) */
    const reqRes = await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests?status=eq.open&select=*&order=created_at.desc`, { headers });
    if (!reqRes.ok) throw new Error('요청 목록 조회 실패');
    const allRequests = await reqRes.json();

    /* 3. 이미 입찰한 요청 ID 목록 */
    const bidsRes = await fetch(`${SUPABASE_URL}/rest/v1/bids?expert_id=eq.${expert.id}&select=request_id`, { headers });
    const myBids = bidsRes.ok ? await bidsRes.json() : [];
    const biddedIds = new Set(myBids.map(b => b.request_id));

    /* 4. specialties 매칭 (전문분야 텍스트 일부라도 겹치면 노출, MVP 단순 매칭) */
    const specialties = expert.specialties || [];
    const matched = allRequests.filter(r => {
      if (biddedIds.has(r.id)) return false;
      if (!specialties.length) return true; // 전문분야 미지정 시 전체 노출
      const types = r.matched_types || [];
      return specialties.some(s => types.some(t => t.includes(s)) || (r.situation_summary || '').includes(s));
    });

    return res.status(200).json({ ok: true, expert: { id: expert.id, name: expert.name, type: expert.type }, requests: matched });

  } catch (err) {
    console.error('expert-requests 오류:', err.message);
    return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}
