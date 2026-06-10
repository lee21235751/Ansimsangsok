function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      ok: false,
      message: "지원하지 않는 요청입니다."
    });
  }

  try {
    const raw = await readBody(req);
    let body = null;

    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        status: "invalid_json",
        message: "웹훅 형식이 올바르지 않습니다."
      });
    }

    return sendJson(res, 200, {
      ok: true,
      status: "webhook_received",
      provider: "toss",
      receivedAt: new Date().toISOString(),
      hasWebhookSecret: Boolean(process.env.PAYMENT_WEBHOOK_SECRET),
      eventType: body && body.eventType ? body.eventType : null,
      message: "웹훅 수신 자리가 준비되었습니다."
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      status: "server_error",
      message: "웹훅 처리 중 문제가 발생했습니다."
    });
  }
}
