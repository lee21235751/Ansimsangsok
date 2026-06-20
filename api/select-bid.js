/**
 * 안심상속 v2: 고객 - 입찰 선택
 * POST /api/select-bid
 * body: { token, bid_id }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const { token, bid_id } = req.body || {};
    if (!token || !bid_id) {
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

    /* 토큰으로 요청 확인 */
    const reqRes = await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests?access_token=eq.${token}&select=id,status`, { headers });
    const requests = await reqRes.json();
    const request = requests[0];
    if (!request) return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });

    /* 요청 상태 closed + selected_bid_id 업데이트 */
    await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests?id=eq.${request.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'closed', selected_bid_id: bid_id })
    });

    /* 선택된 입찰 status='selected', 나머지는 'not_selected' */
    await fetch(`${SUPABASE_URL}/rest/v1/bids?id=eq.${bid_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'selected' })
    });
    await fetch(`${SUPABASE_URL}/rest/v1/bids?request_id=eq.${request.id}&id=neq.${bid_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'not_selected' })
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('select-bid 오류:', err.message);
    return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}
