// api/payapp-feedback.js
// 역할: 페이앱 서버가 결제 상태 변경 시 POST 호출
//       → linkval 검증 → paid_reports status='paid' 업데이트
//       → 리포트 생성은 브라우저(payment-success.html)에서 담당

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(Object.fromEntries(new URLSearchParams(raw))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  let body;
  try { body = await parseBody(req); }
  catch (e) {
    console.error('[payapp-feedback] body 파싱 실패:', e);
    return res.status(200).send('SUCCESS');
  }

  const {
    pay_state,  // 1=요청, 4=결제완료, (8,16,32)=요청취소, (9,64)=승인취소
    mul_no,     // 페이앱 거래번호 (중복방지용)
    mul_pay_no,
    linkval,    // 연동 VALUE (보안 검증)
    price,
    var1,       // email (payapp-request에서 전달)
    var2,       // orderId (payapp-request에서 전달)
    pay_date,
    pay_type,
  } = body;

  console.log('[payapp-feedback] 수신 pay_state=%s orderId=%s', pay_state, var2);

  // ── 1. linkval 검증 ──
  const LINKVAL = process.env.PAYAPP_LINKVALUE || '';
  if (!LINKVAL || linkval !== LINKVAL) {
    console.error('[payapp-feedback] linkval 불일치');
    return res.status(200).send('FAIL');
  }

  // ── 2. 결제완료(pay_state='4')만 처리 ──
  //    pay_state: 1=요청, 4=결제완료, (8,16,32)=요청취소, (9,64)=승인취소
  if (pay_state !== '4') {
    console.log('[payapp-feedback] pay_state=%s — 건너뜀', pay_state);
    return res.status(200).send('SUCCESS');
  }

  // ── 3. 금액 검증 ──
  const parsedPrice = parseInt(price || '0');
  if (![49000, 79000].includes(parsedPrice)) {
    console.error('[payapp-feedback] 금액 이상:', parsedPrice);
    return res.status(200).send('FAIL');
  }

  const orderId = (var2 || '').trim();
  const txId    = mul_no || mul_pay_no || '';

  // ── 4. Supabase: paid_reports 업데이트 ──
  const sbUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (sbUrl && sbKey && orderId) {
    try {
      // 중복 처리 방지: 이미 paid인지 확인
      const existsRes = await fetch(
        `${sbUrl}/rest/v1/paid_reports?order_id=eq.${encodeURIComponent(orderId)}&select=status`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      const existsRows = existsRes.ok ? await existsRes.json() : [];
      if (Array.isArray(existsRows) && existsRows.some(r => r.status === 'paid')) {
        console.log('[payapp-feedback] 이미 처리된 orderId:', orderId);
        return res.status(200).send('SUCCESS');
      }

      // status → paid 업데이트
      await fetch(
        `${sbUrl}/rest/v1/paid_reports?order_id=eq.${encodeURIComponent(orderId)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            status:      'paid',
            payment_key: txId,
            amount:      parsedPrice,
          }),
        }
      );
      console.log('[payapp-feedback] paid_reports 업데이트 완료 orderId=%s', orderId);

    } catch (dbErr) {
      console.error('[payapp-feedback] Supabase 오류:', dbErr.message);
      // DB 오류가 있어도 SUCCESS 반환 (페이앱 재시도 방지)
    }
  } else {
    console.warn('[payapp-feedback] Supabase 환경변수 없음 또는 orderId 없음');
  }

  // ── 5. 페이앱에 SUCCESS 응답 ──
  return res.status(200).send('SUCCESS');
}
