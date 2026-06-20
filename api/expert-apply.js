/**
 * 안심상속 v2: 전문가(변호사/세무사) 등록 신청 API
 * POST /api/expert-apply
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const { type, name, license_number, office_name, specialties, region, email, phone, intro } = req.body || {};

    if (!type || !name || !license_number || !email) {
      return res.status(400).json({ ok: false, message: '필수 항목이 누락되었습니다.' });
    }
    if (!['lawyer', 'tax_accountant'].includes(type)) {
      return res.status(400).json({ ok: false, message: '구분 값이 올바르지 않습니다.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase 환경변수 누락');
    }

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/experts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        type,
        name,
        license_number,
        office_name: office_name || null,
        specialties: Array.isArray(specialties) ? specialties : [],
        region: region || null,
        email,
        phone: phone || null,
        intro: intro || null,
        subscription_status: 'pending'
      })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('Supabase insert 실패:', errText);
      throw new Error('전문가 등록 저장 실패');
    }

    const inserted = await insertRes.json();
    return res.status(200).json({ ok: true, id: inserted[0]?.id });

  } catch (err) {
    console.error('expert-apply 오류:', err.message);
    return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}
