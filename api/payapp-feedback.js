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
    var1,       // email (미사용)
    var2,       // orderId
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
    /* Supabase 쓰기 헬퍼: fetch는 HTTP 4xx/5xx에서 throw하지 않으므로 res.ok를 직접 확인하고 1회 재시도한다.
       이 확인이 없어 결제 확정 기록이 조용히 실패하면 고객이 돈을 내고도 미결제 상태로 남는다(과거 사고 클래스). */
    const sbWrite = async (url, method, bodyObj) => {
      for (let i = 1; i <= 2; i++) {
        try {
          const r = await fetch(url, {
            method,
            headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(bodyObj),
          });
          if (r.ok) return true;
          const t = await r.text().catch(() => '');
          console.error(`[payapp-feedback] ${method} 실패 attempt=${i} orderId=${orderId} status=${r.status} body=${t}`);
        } catch (e) {
          console.error(`[payapp-feedback] ${method} 예외 attempt=${i} orderId=${orderId} msg=${e.message}`);
        }
      }
      return false;
    };

    try {
      // 기존 row 확인
      const existsRes = await fetch(
        `${sbUrl}/rest/v1/paid_reports?order_id=eq.${encodeURIComponent(orderId)}&select=status`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      const existsRows = existsRes.ok ? await existsRes.json() : [];

      // 이미 paid면 중복 — 그대로 성공 응답
      if (Array.isArray(existsRows) && existsRows.some(r => r.status === 'paid')) {
        console.log('[payapp-feedback] 이미 처리된 orderId:', orderId);
        return res.status(200).send('SUCCESS');
      }

      let writeOk;
      if (Array.isArray(existsRows) && existsRows.length > 0) {
        // row가 있으면 paid로 업데이트
        writeOk = await sbWrite(
          `${sbUrl}/rest/v1/paid_reports?order_id=eq.${encodeURIComponent(orderId)}`,
          'PATCH',
          { status: 'paid', payment_key: txId, amount: parsedPrice }
        );
      } else {
        // row가 없으면 새로 삽입
        writeOk = await sbWrite(
          `${sbUrl}/rest/v1/paid_reports`,
          'POST',
          { order_id: orderId, status: 'paid', payment_key: txId, amount: parsedPrice, report_generated: false }
        );
      }

      if (writeOk) {
        console.log('[payapp-feedback] paid_reports 결제확정 기록 완료 orderId=%s', orderId);
      } else {
        /* 결제는 됐는데 DB 기록에 최종 실패 — 절대 유실되면 안 되는 데이터라 전부 로그에 남겨 수동 복구한다.
           (PayApp에 FAIL을 반환해 자동 재시도를 받는 방법도 있으나, PayApp 재시도 의미가 확실할 때만 권장.) */
        console.error('[payapp-feedback] CRITICAL 결제확정 DB기록 최종실패 수동복구필요 orderId=%s txId=%s amount=%s', orderId, txId, parsedPrice);
      }

    } catch (dbErr) {
      console.error('[payapp-feedback] CRITICAL Supabase 예외 orderId=%s txId=%s amount=%s msg=%s', orderId, txId, parsedPrice, dbErr.message);
    }
  } else {
    console.warn('[payapp-feedback] Supabase 환경변수 없음 또는 orderId 없음');
  }

  // ── 5. 페이앱에 SUCCESS 응답 ──
  return res.status(200).send('SUCCESS');
}
