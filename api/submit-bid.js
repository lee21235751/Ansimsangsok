/**
 * 안심상속 v2: 전문가 - 입찰(견적) 제출
 * POST /api/submit-bid
 * body: { token, request_id, proposed_fee, available_dates, message }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const { token, request_id, proposed_fee, available_dates, message } = req.body || {};
    if (!token || !request_id || !proposed_fee) {
      return res.status(400).json({ ok: false, message: '필수 항목이 누락되었습니다.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase 환경변수 누락');
    }
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    };

    /* 토큰으로 전문가 확인 */
    const expertRes = await fetch(`${SUPABASE_URL}/rest/v1/experts?access_token=eq.${token}&select=id,subscription_status`, { headers });
    const experts = await expertRes.json();
    const expert = experts[0];
    if (!expert) return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });
    if (expert.subscription_status !== 'active') {
      return res.status(403).json({ ok: false, message: '구독이 활성화되지 않았습니다.' });
    }

    /* 입찰 저장 (request_id + expert_id 유니크 제약으로 중복 입찰 방지) */
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/bids`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        request_id,
        expert_id: expert.id,
        proposed_fee,
        available_dates: available_dates || null,
        message: message || null,
        status: 'submitted'
      })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('입찰 저장 실패:', errText);
      if (errText.includes('duplicate') || errText.includes('unique')) {
        return res.status(409).json({ ok: false, message: '이미 이 요청에 입찰하셨습니다.' });
      }
      throw new Error('입찰 저장 실패');
    }

    const inserted = await insertRes.json();
    return res.status(200).json({ ok: true, id: inserted[0]?.id });

  } catch (err) {
    console.error('submit-bid 오류:', err.message);
    return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}
