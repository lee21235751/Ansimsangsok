/**
 * 안심상속 v2: 고객 - 받은 입찰(견적) 목록 조회
 * GET /api/get-bids?token=xxx
 *
 * consultation_requests.access_token으로 간이 인증
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

    const reqRes = await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests?access_token=eq.${token}&select=*`, { headers });
    const requests = await reqRes.json();
    const request = requests[0];
    if (!request) {
      return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });
    }

    const bidsRes = await fetch(`${SUPABASE_URL}/rest/v1/bids?request_id=eq.${request.id}&select=*,experts(name,office_name,type,career_years,intro)&order=created_at.asc`, { headers });
    const bids = bidsRes.ok ? await bidsRes.json() : [];

    return res.status(200).json({ ok: true, request, bids });

  } catch (err) {
    console.error('get-bids 오류:', err.message);
    return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}
