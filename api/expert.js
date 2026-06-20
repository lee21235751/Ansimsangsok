/**
 * 안심상속 v2: 전문가 통합 API
 * 함수 개수 절약을 위해 expert-apply / expert-requests / submit-bid를 1개로 통합
 *
 * GET  /api/expert?action=requests&token=xxx        → 매칭된 상담 요청 목록
 * POST /api/expert  body:{action:'apply', ...}       → 전문가 등록 신청
 * POST /api/expert  body:{action:'bid', token, request_id, ...} → 입찰 제출
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbHeaders(extra) {
  return {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...(extra || {})
  };
}

async function handleApply(req, res) {
  const { type, name, license_number, office_name, specialties, region, email, phone, intro } = req.body || {};
  if (!type || !name || !license_number || !email) {
    return res.status(400).json({ ok: false, message: '필수 항목이 누락되었습니다.' });
  }
  if (!['lawyer', 'tax_accountant'].includes(type)) {
    return res.status(400).json({ ok: false, message: '구분 값이 올바르지 않습니다.' });
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/experts`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
    body: JSON.stringify({
      type, name, license_number,
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
    console.error('expert apply insert 실패:', await insertRes.text());
    throw new Error('전문가 등록 저장 실패');
  }
  const inserted = await insertRes.json();
  return res.status(200).json({ ok: true, id: inserted[0]?.id });
}

async function handleListRequests(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ ok: false, message: '접근 토큰이 필요합니다.' });

  const expertRes = await fetch(`${SUPABASE_URL}/rest/v1/experts?access_token=eq.${token}&select=*`, { headers: sbHeaders() });
  const experts = await expertRes.json();
  const expert = experts[0];
  if (!expert) return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });
  if (expert.subscription_status !== 'active') {
    return res.status(200).json({ ok: true, expert, requests: [], notice: '구독이 활성화되지 않아 요청을 볼 수 없습니다. 안심상속에 문의해주세요.' });
  }

  const reqRes = await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests?status=eq.open&select=*&order=created_at.desc`, { headers: sbHeaders() });
  const allRequests = await reqRes.json();

  const bidsRes = await fetch(`${SUPABASE_URL}/rest/v1/bids?expert_id=eq.${expert.id}&select=request_id`, { headers: sbHeaders() });
  const myBids = bidsRes.ok ? await bidsRes.json() : [];
  const biddedIds = new Set(myBids.map(b => b.request_id));

  const specialties = expert.specialties || [];
  const matched = allRequests.filter(r => {
    if (biddedIds.has(r.id)) return false;
    if (!specialties.length) return true;
    const types = r.matched_types || [];
    return specialties.some(s => types.some(t => t.includes(s)) || (r.situation_summary || '').includes(s));
  });

  return res.status(200).json({ ok: true, expert: { id: expert.id, name: expert.name, type: expert.type }, requests: matched });
}

async function handleSubmitBid(req, res) {
  const { token, request_id, proposed_fee, available_dates, message } = req.body || {};
  if (!token || !request_id || !proposed_fee) {
    return res.status(400).json({ ok: false, message: '필수 항목이 누락되었습니다.' });
  }

  const expertRes = await fetch(`${SUPABASE_URL}/rest/v1/experts?access_token=eq.${token}&select=id,subscription_status`, { headers: sbHeaders() });
  const experts = await expertRes.json();
  const expert = experts[0];
  if (!expert) return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });
  if (expert.subscription_status !== 'active') {
    return res.status(403).json({ ok: false, message: '구독이 활성화되지 않았습니다.' });
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/bids`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
    body: JSON.stringify({
      request_id, expert_id: expert.id, proposed_fee,
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
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ ok: false, message: 'Supabase 환경변수 누락' });
  }
  try {
    if (req.method === 'GET') {
      const action = req.query.action;
      if (action === 'requests') return await handleListRequests(req, res);
      return res.status(400).json({ ok: false, message: '알 수 없는 action입니다.' });
    }
    if (req.method === 'POST') {
      const action = (req.body || {}).action;
      if (action === 'apply') return await handleApply(req, res);
      if (action === 'bid') return await handleSubmitBid(req, res);
      return res.status(400).json({ ok: false, message: '알 수 없는 action입니다.' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  } catch (err) {
    console.error('expert API 오류:', err.message);
    return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}
