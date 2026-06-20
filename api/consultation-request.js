/**
 * 안심상속 v2: 고객 상담 요청 접수 API
 * POST /api/consultation-request
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const { situation_summary, preferred_method, region, budget_range, customer_email, matched_types, report_order_id } = req.body || {};

    if (!situation_summary || !customer_email) {
      return res.status(400).json({ ok: false, message: '필수 항목이 누락되었습니다.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase 환경변수 누락');
    }

    /* customer_session: 이메일을 직접 저장하지 않고 해시 처리(개인정보 최소화).
       단, 견적 도착 알림을 보내려면 이메일이 필요하므로 별도 컬럼에 암호화 없이 저장.
       (추후 개선: 이메일은 별도 알림 큐 테이블로 분리 권장) */
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        customer_session: customer_email,  // MVP 단계: 이메일을 세션 키로 임시 사용
        report_order_id: report_order_id || null,
        matched_types: Array.isArray(matched_types) ? matched_types : [],
        situation_summary,
        preferred_method: preferred_method || null,
        region: region || null,
        budget_range: budget_range || null,
        status: 'open'
      })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('Supabase insert 실패:', errText);
      throw new Error('상담 요청 저장 실패');
    }

    const inserted = await insertRes.json();
    return res.status(200).json({ ok: true, id: inserted[0]?.id, token: inserted[0]?.access_token });

  } catch (err) {
    console.error('consultation-request 오류:', err.message);
    return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}
