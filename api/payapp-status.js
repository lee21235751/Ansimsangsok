// api/payapp-status.js
// 역할: payment-success.html이 orderId로 결제 완료 여부를 폴링하는 엔드포인트
//       Supabase paid_reports에서 status='paid'인지 확인 → { paid: true/false }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const orderId = (req.query && req.query.orderId) ? String(req.query.orderId) : '';
  if (!orderId) {
    return res.status(400).json({ paid: false, error: 'orderId 누락' });
  }

  const sbUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!sbUrl || !sbKey) {
    return res.status(500).json({ paid: false, error: 'Supabase 환경변수 없음' });
  }

  try {
    const r = await fetch(
      `${sbUrl}/rest/v1/paid_reports?order_id=eq.${encodeURIComponent(orderId)}&select=status`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    const rows = r.ok ? await r.json() : [];
    const paid = Array.isArray(rows) && rows.some(row => row.status === 'paid');
    return res.status(200).json({ paid });
  } catch (e) {
    console.error('[payapp-status] 오류:', e);
    return res.status(500).json({ paid: false, error: '조회 오류' });
  }
}
