/* 안심상속 Toss Payments 결제 승인 엔드포인트
   경로: /api/confirm-payment
   역할: 클라이언트에서 결제 인증(카드사 인증)까지 마친 후, 여기서 실제 승인 API를 호출해 결제를 완료시킴.
   결제 승인은 반드시 서버에서 처리해야 함(시크릿 키 노출 방지, 금액 위변조 방지). */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method Not Allowed' });
    return;
  }

  const secretKey = process.env.PAYMENT_SECRET_KEY || process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    res.status(500).json({ message: 'PAYMENT_SECRET_KEY 환경변수가 설정되지 않았습니다.' });
    return;
  }

  try {
    const { paymentKey, orderId, amount } = req.body || {};

    if (!paymentKey || !orderId || amount == null) {
      res.status(400).json({ message: '필수 결제 정보(paymentKey, orderId, amount)가 누락되었습니다.' });
      return;
    }

    /* 핵심 보안 검증: 클라이언트가 보낸 금액이 우리 서버가 알고 있는 정상 금액과 일치하는지 확인.
       이게 없으면 누군가 브라우저 콘솔에서 amount 값을 조작해 더 싼 값으로 결제 승인을 시도할 수 있음. */
    const expectedAmount = 49000; /* 안심상속 유료 상세리포트 특가 - 가격 변경 시 이 값도 함께 수정할 것 */
    if (Number(amount) !== expectedAmount) {
      res.status(400).json({ message: '결제 금액이 일치하지 않습니다.' });
      return;
    }

    const encryptedSecretKey = 'Basic ' + Buffer.from(secretKey + ':').toString('base64');

    const tossResponse = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: encryptedSecretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    const tossData = await tossResponse.json();

    if (!tossResponse.ok) {
      /* Toss가 반환하는 에러를 그대로 클라이언트에 전달 (카드 한도 초과, 인증 만료 등) */
      res.status(tossResponse.status).json(tossData);
      return;
    }

    /* 결제 승인 성공. paid_reports 테이블에 저장해 리포트 생성 시 결제 여부를 검증할 수 있게 함.
       이 저장이 없으면 누구나 /api/generate-report를 직접 호출해 결제 없이 리포트를 받을 수 있음. */
    const sbUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (sbUrl && sbKey) {
      try {
        await fetch(sbUrl + '/rest/v1/paid_reports', {
          method: 'POST',
          headers: {
            apikey: sbKey,
            Authorization: 'Bearer ' + sbKey,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            order_id: orderId,
            payment_key: paymentKey,
            amount: Number(amount),
            status: 'paid',
            report_generated: false,
          }),
        });
      } catch (sbErr) {
        console.error('Supabase 저장 실패(결제 자체는 정상 처리됨):', sbErr.message);
      }
    } else {
      console.error('SUPABASE_URL(또는 VITE_SUPABASE_URL) 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수 누락 - 결제 기록이 저장되지 않음');
    }

    res.status(200).json(tossData);
  } catch (err) {
    console.error('결제 승인 처리 중 오류:', err);
    res.status(500).json({ message: '결제 승인 처리 중 오류가 발생했습니다.' });
  }
}
