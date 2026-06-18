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
        reject(new Error("?붿껌 蹂몃Ц???덈Т ?쎈땲??"));
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

function normalizeEnvFlag(value) {
  return normalizeEnvValue(value).toLowerCase() === "true";
}

function sanitizeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getConfiguredPaymentMethods() {
  const raw = process.env.PAYMENT_METHODS || "card,kakao_pay,naver_pay";
  const allowed = new Set(["card", "kakao_pay", "naver_pay", "toss_pay", "bank_transfer"]);
  const labels = {
    card: "?좎슜移대뱶쨌泥댄겕移대뱶",
    kakao_pay: "移댁뭅?ㅽ럹??,
    naver_pay: "?ㅼ씠踰꾪럹??,
    toss_pay: "?좎뒪?섏씠",
    bank_transfer: "怨꾩쥖?댁껜"
  };

  return raw
    .split(",")
    .map(value => value.trim())
    .filter(value => allowed.has(value))
    .map(value => ({
      key: value,
      label: labels[value] || value
    }));
}

function getPaymentConfig(req) {
  const host = req.headers && req.headers.host ? String(req.headers.host) : "www.ansimsangsok.com";
  const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
  const baseUrl = protocol + "://" + host;

  return {
    provider: normalizeEnvValue(process.env.PAYMENT_PROVIDER || "mock"),
    clientKeyConfigured: Boolean(normalizeEnvValue(process.env.PAYMENT_CLIENT_KEY)),
    secretKeyConfigured: Boolean(normalizeEnvValue(process.env.PAYMENT_SECRET_KEY)),
    webhookSecretConfigured: Boolean(normalizeEnvValue(process.env.PAYMENT_WEBHOOK_SECRET)),
    methods: getConfiguredPaymentMethods(),
    primaryMethodLabel: process.env.PAYMENT_PRIMARY_METHOD_LABEL || "?좎슜移대뱶쨌移댁뭅?ㅽ럹?는룸꽕?대쾭?섏씠",
    successUrl: process.env.PAYMENT_SUCCESS_URL || baseUrl + "/?payment=success",
    failUrl: process.env.PAYMENT_FAIL_URL || baseUrl + "/?payment=fail",
    cancelUrl: process.env.PAYMENT_CANCEL_URL || baseUrl + "/?payment=cancel",
    tossTestRouteEnabled: normalizeEnvFlag(process.env.PAYMENT_TOSS_TEST_ROUTE_ENABLED),
    tossTestRouteTokenConfigured: Boolean(normalizeEnvValue(process.env.PAYMENT_TOSS_TEST_ROUTE_TOKEN))
  };
}

function makeOrderId() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");

  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return "ASR-" + stamp + "-" + random;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      ok: false,
      message: "吏?먰븯吏 ?딅뒗 ?붿껌?낅땲??"
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
        message: "?붿껌 ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎."
      });
    }

    const productType = sanitizeText(body.productType, 80) || "paid-detail-report";
    const name = sanitizeText(body.name, 80);
    const email = sanitizeText(body.email, 160);
    const score = Number(body.score || 0);
    const amount = 69000; // 런칭 특가 (정가 99,000원)
    const tossTestMode = body.tossTestMode === true;
    const tossTestToken = sanitizeText(body.tossTestToken, 160);
    const paymentConfig = getPaymentConfig(req);

    const tossTestAllowed =
      tossTestMode &&
      paymentConfig.tossTestRouteEnabled &&
      paymentConfig.provider === "toss" &&
      paymentConfig.clientKeyConfigured &&
      (
        !paymentConfig.tossTestRouteTokenConfigured ||
        tossTestToken === normalizeEnvValue(process.env.PAYMENT_TOSS_TEST_ROUTE_TOKEN)
      );

    if (productType !== "paid-detail-report") {
      return sendJson(res, 400, {
        ok: false,
        message: "吏?먰븯吏 ?딅뒗 ?곸냽?뺣━ 由ы룷???좏삎?낅땲??"
      });
    }

    const order = {
      ok: true,
      status: "payment_ready",
      orderId: makeOrderId(),
      productType,
      productName: "?덉떖?곸냽 ?곸냽?뺣━ 由ы룷??,
      amount,
      currency: "KRW",
      buyer: {
        name,
        email
      },
      score: Number.isFinite(score) ? score : 0,
      createdAt: new Date().toISOString(),
      payment: {
        provider: tossTestAllowed ? "toss" : paymentConfig.provider,
        mode: tossTestAllowed ? "toss_test_ready" : (paymentConfig.provider === "mock" ? "payment_ready_only" : "pg_ready"),
        successUrl: paymentConfig.successUrl,
        failUrl: paymentConfig.failUrl,
        cancelUrl: paymentConfig.cancelUrl,
        clientKeyConfigured: paymentConfig.clientKeyConfigured,
        secretKeyConfigured: paymentConfig.secretKeyConfigured,
        webhookSecretConfigured: paymentConfig.webhookSecretConfigured,
        methods: paymentConfig.methods,
        primaryMethodLabel: paymentConfig.primaryMethodLabel,
        tossCheckout: (paymentConfig.provider === "toss" || tossTestAllowed) ? {
          clientKeyConfigured: paymentConfig.clientKeyConfigured,
          clientKey: paymentConfig.clientKeyConfigured ? normalizeEnvValue(process.env.PAYMENT_CLIENT_KEY) : null,
          orderName: "?덉떖?곸냽 ?곸냽?뺣━ 由ы룷??,
          customerName: name || "",
          customerEmail: email || "",
          useEscrow: false,
          allowedMethods: paymentConfig.methods.map(method => method.key),
          testMode: tossTestAllowed
        } : null
      },
      testRoute: {
        requested: tossTestMode,
        allowed: tossTestAllowed,
        enabled: paymentConfig.tossTestRouteEnabled
      },
      message: "寃곗젣 以鍮??뺣낫媛 ?앹꽦?섏뿀?듬땲??"
    };

    return sendJson(res, 200, order);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      message: "寃곗젣 以鍮??뺣낫瑜?留뚮뱶??以?臾몄젣媛 諛쒖깮?덉뒿?덈떎."
    });
  }
}

