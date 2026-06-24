// api/payapp-request.js
// 역할: 프론트에서 orderId + email + phone 수신
//       → Supabase paid_reports에 pending으로 저장
//       → 페이앱 REST API 호출 → payurl 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://ansimsangsok.kr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { orderId, email, phone, price = 49000 } = req.body || {};

    // ── 입력 검증 ──
    if (!orderId || typeof orderId !== 'string' || orderId.length < 8) {
      return res.status(400).json({ error: 'orderId가 없습니다.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: '이메일 주소를 확인해주세요.' });
    }
    const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: '전화번호를 확인해주세요.' });
    }
    const parsedPrice = parseInt(price);
    if (![49000, 79000].includes(parsedPrice)) {
      return res.status(400).json({ error: '잘못된 결제 금액입니다.' });
    }

    const sbUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    // ── 중복 orderId 방지 ──
    if (sbUrl && sbKey) {
      try {
        const dupRes = await fetch(
          `${sbUrl}/rest/v1/paid_reports?order_id=eq.${encodeURIComponent(orderId)}&select=status`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        );
        const dupRows = dupRes.ok ? await dupRes.json() : [];
        if (Array.isArray(dupRows) && dupRows.length > 0) {
          // 이미 paid면 바로 실패 반환
          if (dupRows.some(r => r.status === 'paid')) {
            return res.status(409).json({ error: '이미 결제된 주문입니다.' });
          }
          // pending이면 그냥 계속 (재시도 허용)
        }
      } catch (_) { /* 중복 체크 실패는 무시하고 진행 */ }
    }

    // ── Supabase: pending 상태로 사전 저장 ──
    if (sbUrl && sbKey) {
      try {
        await fetch(`${sbUrl}/rest/v1/paid_reports`, {
          method: 'POST',
          headers: {
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            order_id:         orderId,
            amount:           parsedPrice,
            status:           'pending',
            report_generated: false,
            // email/phone은 스키마에 있으면 저장, 없으면 제거
          }),
        });
      } catch (sbErr) {
        console.error('[payapp-request] Supabase 저장 실패(진행 계속):', sbErr.message);
      }
    }

    // ── 페이앱 REST API 호출 ──
    const params = new URLSearchParams({
      cmd:         'payrequest',
      userid:      process.env.PAYAPP_USERID  || '',
      linkkey:     process.env.PAYAPP_LINKKEY || '',
      goodname:    '\uc548\uc2ec\uc0c1\uc18d \uc0c1\uc138\ub9ac\ud3ec\ud2b8',
      price:       String(parsedPrice),
      recvphone:   cleanPhone,
      smsuse:      'n',
      feedbackurl: 'https://ansimsangsok.kr/api/payapp-feedback',
      returnurl:   'https://ansimsangsok.kr/payment-success.html',
      var1:        email,     // feedbackurl에서 그대로 수신됨
      var2:        orderId,   // feedbackurl에서 paid_reports 업데이트에 사용
      reqaddr:     'n',
      shopname:    '\uc548\uc2ec\uc0c1\uc18d',
    });

    const payappRes = await fetch('https://api.payapp.kr/oapi/apiLoad.html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString(),
    });
    const rawText = await payappRes.text();
    const result  = Object.fromEntries(new URLSearchParams(rawText));

    // 페이앱 성공 응답: state === '1' (결제요청성공)
    if (result.state !== '1') {
      console.error('[payapp-request] API 오류:', result);
      return res.status(502).json({
        error: result.errorMessage || '결제 요청에 실패했습니다.',
        code:  result.errno || result.state,
      });
    }

    return res.status(200).json({
      ok:     true,
      payurl: result.payurl,
      mulNo:  result.mul_pay_no || '',
    });

  } catch (err) {
    console.error('[payapp-request] 예외:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
}
