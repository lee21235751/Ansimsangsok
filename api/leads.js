const RESEND_API_URL = "https://api.resend.com/emails";

function sanitizeLeadNotifyText(value, maxLength = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
}

function escapeLeadNotifyHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendLeadNotificationV1({ name, email, memo, score, createdAt }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || "";
  const from = process.env.LEAD_NOTIFY_FROM || "안심상속 <leads@send.ansimsangsok.kr>";

  if (!apiKey || !to || !from) {
    console.warn("Lead notification skipped: missing Resend environment variables");
    return { ok: false, skipped: true };
  }

  const safeName = sanitizeLeadNotifyText(name, 120) || "이름 없음";
  const safeEmail = sanitizeLeadNotifyText(email, 180) || "이메일 없음";
  const safeMemo = sanitizeLeadNotifyText(memo, 800) || "메모 없음";
  const safeScore = score === null || score === undefined ? "없음" : String(score);
  const safeCreatedAt = sanitizeLeadNotifyText(createdAt, 80);

  const subject = "[안심상속] 신규 리드 접수 - " + safeName;

  const text = [
    "안심상속 신규 리드가 접수되었습니다.",
    "",
    "이름: " + safeName,
    "이메일: " + safeEmail,
    "진단 점수: " + safeScore,
    "접수 시각: " + safeCreatedAt,
    "",
    "메모:",
    safeMemo,
    "",
    "Supabase leads 테이블에서 상세 내용을 확인하세요.",
    "",
    "운영자 빠른 응대 문구:",
    "안녕하세요. 안심상속입니다.",
    "신청해주신 내용을 확인했습니다.",
    "상속정리 리포트는 현재 상황을 정리하고, 확인할 항목과 상담 전 준비할 질문을 정리하는 자료입니다.",
    "리포트 확인을 원하시면 안내드리는 순서에 따라 진행해 주세요.",
    "",
    "처리 체크리스트:",
    "1. 이름과 이메일이 정상인지 확인",
    "2. 메모에 급한 일정이나 특이사항이 있는지 확인",
    "3. 리포트 안내 답장 발송",
    "4. 결제/수령 안내 여부 기록",
    "5. 실제 고객이 아닌 테스트 리드는 삭제 또는 테스트 표시"
  ].join("\n");

  const html = [
    "<h2>안심상속 신규 리드 접수</h2>",
    "<p>Supabase leads 테이블에 신규 리드가 저장되었습니다.</p>",
    "<table cellpadding=\"8\" cellspacing=\"0\" style=\"border-collapse:collapse;border:1px solid #ddd\">",
    "<tr><th align=\"left\" style=\"border:1px solid #ddd;background:#f7f7f7\">이름</th><td style=\"border:1px solid #ddd\">" + escapeLeadNotifyHtml(safeName) + "</td></tr>",
    "<tr><th align=\"left\" style=\"border:1px solid #ddd;background:#f7f7f7\">이메일</th><td style=\"border:1px solid #ddd\">" + escapeLeadNotifyHtml(safeEmail) + "</td></tr>",
    "<tr><th align=\"left\" style=\"border:1px solid #ddd;background:#f7f7f7\">진단 점수</th><td style=\"border:1px solid #ddd\">" + escapeLeadNotifyHtml(safeScore) + "</td></tr>",
    "<tr><th align=\"left\" style=\"border:1px solid #ddd;background:#f7f7f7\">접수 시각</th><td style=\"border:1px solid #ddd\">" + escapeLeadNotifyHtml(safeCreatedAt) + "</td></tr>",
    "</table>",
    "<h3>메모</h3>",
    "<p style=\"white-space:pre-wrap\">" + escapeLeadNotifyHtml(safeMemo) + "</p>",
    "<p>Supabase leads 테이블에서 상세 내용을 확인하세요.</p>",
    "<hr style=\"border:none;border-top:1px solid #e5e7eb;margin:18px 0\">",
    "<h3>운영자 빠른 응대 문구</h3>",
    "<div style=\"padding:12px 14px;border:1px solid #e5e7eb;background:#fafafa;border-radius:10px;line-height:1.7\">",
    "<p>안녕하세요. 안심상속입니다.</p>",
    "<p>신청해주신 내용을 확인했습니다.</p>",
    "<p>상속정리 리포트는 현재 상황을 정리하고, 확인할 항목과 상담 전 준비할 질문을 정리하는 자료입니다.</p>",
    "<p>리포트 확인을 원하시면 안내드리는 순서에 따라 진행해 주세요.</p>",
    "</div>",
    "<h3>처리 체크리스트</h3>",
    "<ol style=\"line-height:1.8\">",
    "<li>이름과 이메일이 정상인지 확인</li>",
    "<li>메모에 급한 일정이나 특이사항이 있는지 확인</li>",
    "<li>리포트 안내 답장 발송</li>",
    "<li>결제/수령 안내 여부 기록</li>",
    "<li>실제 고객이 아닌 테스트 리드는 삭제 또는 테스트 표시</li>",
    "</ol>"
  ].join("");

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Lead notification email failed", response.status, responseText);
      return { ok: false, status: response.status };
    }

    return { ok: true };
  } catch (error) {
    console.error("Lead notification email error", error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL;

    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY;

    const leadsTable =
      process.env.SUPABASE_LEADS_TABLE ||
      process.env.VITE_SUPABASE_LEADS_TABLE ||
      "leads";

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase environment variables");
      return res.status(500).json({
        ok: false,
        message: "안내자료 신청을 접수하지 못했습니다."
      });
    }

    const body = req.body || {};
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const memo = String(body.memo || "").trim();
    const score = Number.isFinite(Number(body.score)) ? Number(body.score) : null;
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const freeReport = body.freeReport && typeof body.freeReport === "object" ? body.freeReport : null;
    const paidReportPreview = body.paidReportPreview && typeof body.paidReportPreview === "object" ? body.paidReportPreview : null;
    const paidReportIntent = body.paidReportIntent && typeof body.paidReportIntent === "object" ? body.paidReportIntent : null;
    const paidReportPaymentIntent = body.paidReportPaymentIntent && typeof body.paidReportPaymentIntent === "object" ? body.paidReportPaymentIntent : null;
    const reportRequestedAt = String(body.reportRequestedAt || "").trim();

    if (!name) {
      return res.status(400).json({ ok: false, message: "성함을 입력해주세요." });
    }

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, message: "이메일을 정확히 입력해주세요." });
    }

    const createdAt = new Date().toISOString();

    const noteParts = [];

    if (memo) {
      noteParts.push(`고객 메모: ${memo}`);
    }

    if (score !== null) {
      noteParts.push(`진단 점수: ${score}`);
    }

    noteParts.push("유입 경로: 안심상속 안내자료 신청");
    noteParts.push("신청 자료: 무료 리포트 요약 + 유료 상세자료 안내");
    noteParts.push("보관 안내: 안내자료 발송 후 30일");

    if (reportRequestedAt) {
      noteParts.push(`리포트 신청 시각: ${reportRequestedAt}`);
    }

    if (freeReport) {
      noteParts.push("무료 리포트 자동 요약:");
      noteParts.push(JSON.stringify(freeReport, null, 2));
    }

    if (paidReportPreview) {
      noteParts.push("유료 상세자료 관심 항목:");
      noteParts.push(JSON.stringify(paidReportPreview, null, 2));
    }

    if (paidReportIntent) {
      noteParts.push("유료 상세자료 안내 희망:");
      noteParts.push(JSON.stringify(paidReportIntent, null, 2));
    }

    if (paidReportPaymentIntent) {
      noteParts.push("유료 상세자료 결제 안내 확인:");
      noteParts.push(JSON.stringify(paidReportPaymentIntent, null, 2));
    }

    if (answers && Object.keys(answers).length > 0) {
      noteParts.push(`진단 답변: ${JSON.stringify(answers)}`);
    }

    const note = noteParts.join("\n");

    const row = {
      name,
      email,
      note,
      created_at: createdAt
    };

    const insertRes = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(leadsTable)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify(row)
    });

    const text = await insertRes.text();

    if (!insertRes.ok) {
      console.error("Supabase leads insert failed", insertRes.status, text);
      return res.status(500).json({
        ok: false,
        message: "안내자료 신청을 접수하지 못했습니다."
      });
    }

    await sendLeadNotificationV1({ name, email, memo, score, createdAt });

    return res.status(200).json({
      ok: true,
      message: "안내자료 신청이 접수되었습니다. 이메일 확인 후 순서대로 안내드릴 수 있습니다."
    });
  } catch (error) {
    console.error("Lead API error", error);
    return res.status(500).json({
      ok: false,
      message: "안내자료 신청을 접수하지 못했습니다."
    });
  }
}