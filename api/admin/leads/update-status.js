function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getEnv(name) {
  return process.env[name] || "";
}

function getSupabaseConfig() {
  const url =
    getEnv("SUPABASE_URL") ||
    getEnv("NEXT_PUBLIC_SUPABASE_URL") ||
    getEnv("VITE_SUPABASE_URL");

  const key =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    getEnv("SUPABASE_SERVICE_KEY") ||
    getEnv("SUPABASE_ANON_KEY") ||
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    getEnv("VITE_SUPABASE_ANON_KEY");

  return {
    url: url ? url.replace(/\/+$/, "") : "",
    key
  };
}

function getRequestToken(req) {
  const headerToken =
    req.headers["x-admin-token"] ||
    req.headers["x-lead-admin-token"] ||
    req.headers["authorization"];

  if (!headerToken) return "";

  const value = Array.isArray(headerToken) ? headerToken[0] : String(headerToken);

  if (value.toLowerCase().startsWith("bearer ")) {
    return value.slice(7).trim();
  }

  return value.trim();
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw.trim()) return {};

  return JSON.parse(raw);
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

const FOLLOWUP_STATUSES = new Set([
  "new",
  "contacted",
  "payment_guided",
  "hold",
  "test"
]);

const PAID_REPORT_STATUSES = new Set([
  "none",
  "guided",
  "interested",
  "paid",
  "declined"
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, {
      ok: false,
      error: "method_not_allowed"
    });
  }

  const expectedToken = getEnv("ADMIN_LEAD_UPDATE_TOKEN");

  if (!expectedToken) {
    return json(res, 503, {
      ok: false,
      error: "admin_token_not_configured"
    });
  }

  const requestToken = getRequestToken(req);

  if (!requestToken || requestToken !== expectedToken) {
    return json(res, 401, {
      ok: false,
      error: "unauthorized"
    });
  }

  let body;

  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, {
      ok: false,
      error: "invalid_json"
    });
  }

  const leadId = String(body.leadId || body.id || "").trim();
  const followupStatus = String(body.followupStatus || body.followup_status || "").trim();
  const paidReportStatus = String(body.paidReportStatus || body.paid_report_status || "").trim();
  const followupNote = cleanText(body.followupNote || body.followup_note || "", 2000);

  if (!isValidUuid(leadId)) {
    return json(res, 400, {
      ok: false,
      error: "invalid_lead_id"
    });
  }

  const patch = {};

  if (followupStatus) {
    if (!FOLLOWUP_STATUSES.has(followupStatus)) {
      return json(res, 400, {
        ok: false,
        error: "invalid_followup_status"
      });
    }

    patch.followup_status = followupStatus;

    if (followupStatus === "contacted" || followupStatus === "payment_guided") {
      patch.last_contacted_at = new Date().toISOString();
    }
  }

  if (paidReportStatus) {
    if (!PAID_REPORT_STATUSES.has(paidReportStatus)) {
      return json(res, 400, {
        ok: false,
        error: "invalid_paid_report_status"
      });
    }

    patch.paid_report_status = paidReportStatus;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "followupNote") ||
    Object.prototype.hasOwnProperty.call(body, "followup_note")
  ) {
    patch.followup_note = followupNote || null;
  }

  if (!Object.keys(patch).length) {
    return json(res, 400, {
      ok: false,
      error: "nothing_to_update"
    });
  }

  const config = getSupabaseConfig();

  if (!config.url || !config.key) {
    return json(res, 503, {
      ok: false,
      error: "supabase_not_configured"
    });
  }

  const endpoint =
    config.url +
    "/rest/v1/leads?id=eq." +
    encodeURIComponent(leadId) +
    "&select=id,name,email,followup_status,paid_report_status,followup_note,last_contacted_at,updated_at";

  let response;
  let responseText;

  try {
    response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        apikey: config.key,
        Authorization: "Bearer " + config.key,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(patch)
    });

    responseText = await response.text();
  } catch {
    return json(res, 502, {
      ok: false,
      error: "supabase_request_failed"
    });
  }

  let data = null;

  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = {
      raw: responseText
    };
  }

  if (!response.ok) {
    return json(res, response.status || 502, {
      ok: false,
      error: "supabase_update_failed",
      detail: data
    });
  }

  const updated = Array.isArray(data) ? data[0] || null : data;

  if (!updated) {
    return json(res, 404, {
      ok: false,
      error: "lead_not_found"
    });
  }

  return json(res, 200, {
    ok: true,
    lead: updated
  });
};

