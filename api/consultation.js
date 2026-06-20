/**
 * 안심상속 v2: 고객 상담 요청 통합 API
 * 함수 개수 절약을 위해 consultation-request / get-bids / select-bid를 1개로 통합
 *
 * POST /api/consultation  body:{action:'create', ...}              → 상담 요청 작성
 * GET  /api/consultation?action=bids&token=xxx                     → 받은 입찰 목록 조회
 * POST /api/consultation  body:{action:'select', token, bid_id}    → 입찰 선택
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbHeaders(extra) {
  return {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...(extra || {})
  };
}

async function handleCreate(req, res) {
  const { situation_summary, preferred_method, region, budget_range, customer_email, matched_types, report_order_id } = req.body || {};
  if (!situation_summary || !customer_email) {
    return res.status(400).json({ ok: false, message: '필수 항목이 누락되었습니다.' });
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
    body: JSON.stringify({
      customer_session: customer_email,
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
    console.error('상담 요청 저장 실패:', await insertRes.text());
    throw new Error('상담 요청 저장 실패');
  }
  const inserted = await insertRes.json();
  return res.status(200).json({ ok: true, id: inserted[0]?.id, token: inserted[0]?.access_token });
}

async function handleGetBids(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ ok: false, message: '접근 토큰이 필요합니다.' });

  const reqRes = await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests?access_token=eq.${token}&select=*`, { headers: sbHeaders() });
  const requests = await reqRes.json();
  const request = requests[0];
  if (!request) return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });

  const bidsRes = await fetch(`${SUPABASE_URL}/rest/v1/bids?request_id=eq.${request.id}&select=*,experts(name,office_name,type,career_years,intro)&order=created_at.asc`, { headers: sbHeaders() });
  const bids = bidsRes.ok ? await bidsRes.json() : [];

  return res.status(200).json({ ok: true, request, bids });
}

async function handleSelect(req, res) {
  const { token, bid_id } = req.body || {};
  if (!token || !bid_id) return res.status(400).json({ ok: false, message: '필수 항목이 누락되었습니다.' });

  const reqRes = await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests?access_token=eq.${token}&select=id,status`, { headers: sbHeaders() });
  const requests = await reqRes.json();
  const request = requests[0];
  if (!request) return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });

  await fetch(`${SUPABASE_URL}/rest/v1/consultation_requests?id=eq.${request.id}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status: 'closed', selected_bid_id: bid_id })
  });
  await fetch(`${SUPABASE_URL}/rest/v1/bids?id=eq.${bid_id}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status: 'selected' })
  });
  await fetch(`${SUPABASE_URL}/rest/v1/bids?request_id=eq.${request.id}&id=neq.${bid_id}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status: 'not_selected' })
  });

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ ok: false, message: 'Supabase 환경변수 누락' });
  }
  try {
    if (req.method === 'GET') {
      const action = req.query.action;
      if (action === 'bids') return await handleGetBids(req, res);
      return res.status(400).json({ ok: false, message: '알 수 없는 action입니다.' });
    }
    if (req.method === 'POST') {
      const action = (req.body || {}).action;
      if (action === 'create') return await handleCreate(req, res);
      if (action === 'select') return await handleSelect(req, res);
      return res.status(400).json({ ok: false, message: '알 수 없는 action입니다.' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  } catch (err) {
    console.error('consultation API 오류:', err.message);
    return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}
