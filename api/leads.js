export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
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

    const baseRow = {
      name,
      email,
      memo,
      score,
      answers,
      source: "ansimsangsok-guide-request",
      retention_note: "안내자료 발송 후 30일",
      user_agent: req.headers["user-agent"] || "",
      created_at: new Date().toISOString()
    };

    const minimalRow = {
      name,
      email,
      memo,
      created_at: baseRow.created_at
    };

    async function insertLead(row) {
      return await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Prefer": "return=representation"
        },
        body: JSON.stringify(row)
      });
    }

    let insertRes = await insertLead(baseRow);
    let text = await insertRes.text();

    if (!insertRes.ok && /column|schema|cache|could not find/i.test(text)) {
      console.error("Full leads insert failed; retrying minimal row", insertRes.status, text);
      insertRes = await insertLead(minimalRow);
      text = await insertRes.text();
    }

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