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

function normalizeEnvValue(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .trim();
}

function sanitizeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      ok: false,
      message: "지원하지 않는 요청입니다."
    });
  }

  const provider = normalizeEnvValue(process.env.PAYMENT_PROVIDER || "mock");

  if (provider !== "toss") {
    return sendJson(res, 200, {
      ok: true,
      provider,
      status: "guide_confirmed",
      message: "현재는 결제 안내 확인 상태로 처리됩니다."
    });
  }

  const paymentSecretKey = normalizeEnvValue(process.env.PAYMENT_SECRET_KEY);

  if (!paymentSecretKey) {
    return sendJson(res, 500, {
      ok: false,
      status: "toss_secret_missing",
      message: "결제 승인 설정이 아직 완료되지 않았습니다."
    });
  }

  try {
    const raw = await readBody(req);
    let body = {};

    try {
      body = raw ? JSON.parse(raw) : {};
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        status: "invalid_json",
        message: "요청 형식이 올바르지 않습니다."
      });
    }

    const paymentKey = sanitizeText(body.paymentKey, 240);
    const orderId = sanitizeText(body.orderId, 120);
    const amount = Number(body.amount || 0);

    if (!paymentKey || !orderId || amount !== 29000) {
      return sendJson(res, 400, {
        ok: false,
        status: "invalid_payment_confirm_payload",
        message: "결제 승인 정보가 올바르지 않습니다."
      });
    }

    const encodedSecret = Buffer.from(paymentSecretKey + ":").toString("base64");

    const response = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + encodedSecret,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      return sendJson(res, response.status || 400, {
        ok: false,
        status: "toss_confirm_failed",
        message: "결제 확인 중 문제가 발생했습니다.",
        tossStatus: data && data.code ? data.code : null
      });
    }

    return sendJson(res, 200, {
      ok: true,
      provider: "toss",
      status: "paid_confirmed",
      orderId: data.orderId || orderId,
      paymentKey: data.paymentKey || paymentKey,
      amount: data.totalAmount || amount,
      method: data.method || null,
      approvedAt: data.approvedAt || null,
      receiptUrl: data.receipt && data.receipt.url ? data.receipt.url : null,
      rawStatus: data.status || null,
      message: "결제 확인이 완료되었습니다."
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      status: "server_error",
      message: "결제 확인 처리 중 문제가 발생했습니다."
    });
  }
}
