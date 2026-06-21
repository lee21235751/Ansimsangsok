/**
 * 안심상속 v2: 전문가 통합 API
 * 함수 개수 절약을 위해 expert-apply / expert-requests / submit-bid를 1개로 통합
 *
 * GET  /api/expert?action=requests&token=xxx        → 매칭된 상담 요청 목록
 * GET  /api/expert?action=mybids&token=xxx           → 내가 제출한 입찰 현황(선택된 건은 고객 연락처 포함)
 * POST /api/expert  body:{action:'apply', ...}       → 전문가 등록 신청
 * POST /api/expert  body:{action:'bid', token, request_id, ...} → 입찰 제출
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* 한 요청당 동시에 받을 수 있는 입찰 수 상한. 너무 많으면 고객도 비교 피로감을 느끼고,
   전문가 입장에서도 당첨 확률이 지나치게 낮아져 이탈 요인이 됨. */
const MAX_BIDS_PER_REQUEST = 8;

/* expert-signup.html의 전문분야 태그(유류분 등)는 한글 짧은 태그인데, 실제 진단 결과의
   matched_types는 generate-report.js의 TYPES 딕셔너리에서 나온 풀어쓴 문장형 라벨임
   (예: "해외 거주 가족·해외 재산이 관련된 상속"). 태그 글자가 그 문장 안에 통째로
   안 들어있는 경우가 많아(특히 해외상속/사업승계/상속분쟁/상속세) 단순 substring 비교로는
   매칭이 거의 안 됨 — 그래서 태그별로 실제 라벨에 등장하는 키워드를 명시적으로 매핑함.
   generate-report.js의 TYPES 딕셔너리가 바뀌면 이 매핑도 같이 점검할 것. */
const SPECIALTY_KEYWORDS = {
  '유류분': ['유류분'],
  '재혼가정': ['재혼가정', '전혼 자녀'],
  '해외상속': ['해외 거주', '해외 재산'],
  '사업승계': ['사업체', '지분', '법인'],
  '상속분쟁': ['갈등', '연락이 끊긴'],
  '상속세': ['세금', '절세', '상속세']
};

function specialtyMatches(specialty, matchedTypeLabels, situationSummary) {
  const keywords = SPECIALTY_KEYWORDS[specialty] || [specialty];
  const haystack = matchedTypeLabels.join(' ') + ' ' + (situationSummary || '');
  return keywords.some(k => haystack.includes(k));
}

function sbHeaders(extra) {
  return {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...(extra || {})
  };
}

/* Fisher-Yates 셔플: 노출 순서를 매 요청마다 무작위로 섞어, 특정 전문가가 항상 목록 상단에
   고정 노출되는 일이 없도록 함(균등 노출 원칙 — 로톡 등 기존 법률플랫폼 선례 참고). */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

  /* 요청별 현재 입찰 수를 한 번에 조회해서, 이미 상한(MAX_BIDS_PER_REQUEST)에 도달한 요청은
     더 이상 노출하지 않음 — 한 요청에 입찰이 쏠려서 다른 요청들 기회가 줄어드는 것을 방지. */
  const bidCountsRes = await fetch(`${SUPABASE_URL}/rest/v1/bids?select=request_id`, { headers: sbHeaders() });
  const allBidsForCount = bidCountsRes.ok ? await bidCountsRes.json() : [];
  const bidCountByRequest = {};
  allBidsForCount.forEach(b => { bidCountByRequest[b.request_id] = (bidCountByRequest[b.request_id] || 0) + 1; });

  const bidsRes = await fetch(`${SUPABASE_URL}/rest/v1/bids?expert_id=eq.${expert.id}&select=request_id`, { headers: sbHeaders() });
  const myBids = bidsRes.ok ? await bidsRes.json() : [];
  const biddedIds = new Set(myBids.map(b => b.request_id));

  const specialties = expert.specialties || [];
  const matched = allRequests.filter(r => {
    if (biddedIds.has(r.id)) return false;
    if ((bidCountByRequest[r.id] || 0) >= MAX_BIDS_PER_REQUEST) return false;
    if (!specialties.length) return true;
    const types = r.matched_types || [];
    return specialties.some(s => specialtyMatches(s, types, r.situation_summary));
  });

  return res.status(200).json({ ok: true, expert: { id: expert.id, name: expert.name, type: expert.type }, requests: shuffle(matched) });
}

async function handleMyBids(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ ok: false, message: '접근 토큰이 필요합니다.' });

  const expertRes = await fetch(`${SUPABASE_URL}/rest/v1/experts?access_token=eq.${token}&select=id`, { headers: sbHeaders() });
  const experts = await expertRes.json();
  const expert = experts[0];
  if (!expert) return res.status(404).json({ ok: false, message: '유효하지 않은 접근입니다.' });

  /* 선택(selected)된 입찰에 한해서만 고객 연락처가 함께 옴 — 선택 안 된 건은 굳이 고객 정보를
     전문가에게 노출할 이유가 없음(개인정보 최소수집 원칙). */
  const bidsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bids?expert_id=eq.${expert.id}&select=*,consultation_requests(situation_summary,customer_name,customer_phone,customer_email,status)&order=created_at.desc`,
    { headers: sbHeaders() }
  );
  const bids = bidsRes.ok ? await bidsRes.json() : [];

  const sanitized = bids.map(b => {
    const cr = b.consultation_requests || {};
    const isSelected = b.status === 'selected';
    return {
      id: b.id,
      proposed_fee: b.proposed_fee,
      status: b.status,
      created_at: b.created_at,
      situation_summary: cr.situation_summary || null,
      customer_name: isSelected ? (cr.customer_name || null) : null,
      customer_phone: isSelected ? (cr.customer_phone || null) : null,
      customer_email: isSelected ? (cr.customer_email || null) : null
    };
  });

  return res.status(200).json({ ok: true, bids: sanitized });
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

  /* 마지막 안전장치: 제출 시점에 이미 상한에 도달했다면 거절(목록 조회 이후 다른 전문가가
     먼저 채웠을 수 있는 경쟁 상황 대비). */
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/bids?request_id=eq.${request_id}&select=id`, { headers: sbHeaders() });
  const existing = countRes.ok ? await countRes.json() : [];
  if (existing.length >= MAX_BIDS_PER_REQUEST) {
    return res.status(409).json({ ok: false, message: '이미 입찰 인원이 마감된 요청입니다.' });
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
      if (action === 'mybids') return await handleMyBids(req, res);
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
