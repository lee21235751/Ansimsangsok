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

function parseLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);

  if (!Number.isFinite(parsed)) return 30;

  return Math.min(Math.max(parsed, 1), 100);
}

function cleanFilter(value, allowed) {
  const text = String(value || "").trim();

  if (!text) return "";

  return allowed.has(text) ? text : "";
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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  const config = getSupabaseConfig();

  if (!config.url || !config.key) {
    return json(res, 503, {
      ok: false,
      error: "supabase_not_configured"
    });
  }

  const url = new URL(req.url, "https://ansimsangsok.kr");
  const limit = parseLimit(url.searchParams.get("limit"));
  const followupStatus = cleanFilter(
    url.searchParams.get("followupStatus") || url.searchParams.get("followup_status"),
    FOLLOWUP_STATUSES
  );
  const paidReportStatus = cleanFilter(
    url.searchParams.get("paidReportStatus") || url.searchParams.get("paid_report_status"),
    PAID_REPORT_STATUSES
  );

  const params = new URLSearchParams();
  params.set(
    "select",
    [
      "id",
      "created_at",
      "name",
      "email",
      "memo",
      "score",
      "note",
      "followup_status",
      "followup_note",
      "last_contacted_at",
      "paid_report_status",
      "updated_at"
    ].join(",")
  );
  params.set("order", "created_at.desc");
  params.set("limit", String(limit));

  if (followupStatus) {
    params.set("followup_status", "eq." + followupStatus);
  }

  if (paidReportStatus) {
    params.set("paid_report_status", "eq." + paidReportStatus);
  }

  const endpoint =
    config.url +
    "/rest/v1/leads?" +
    params.toString();

  let response;
  let responseText;

  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: config.key,
        Authorization: "Bearer " + config.key,
        Accept: "application/json"
      }
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
      error: "supabase_list_failed",
      detail: data
    });
  }

  return json(res, 200, {
    ok: true,
    count: Array.isArray(data) ? data.length : 0,
    leads: Array.isArray(data) ? data : []
  });
}
