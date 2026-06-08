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
    noteParts.push("보관 안내: 안내자료 발송 후 30일");

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