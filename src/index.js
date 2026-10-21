const RICH_COUNTRIES = ["US", "GB", "RU", "CN", "JP"];
const DURATION_MS = 10 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const VALID_PRICES = [
  { currency: "INR", amount: 99900 },
  { currency: "USD", amount: 2900 },
  { currency: "USD", amount: 1200 },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function getCountry(request) {
  const c = request.cf && request.cf.country;
  if (c && /^[A-Za-z]{2}$/.test(c)) {
    const code = c.toUpperCase();
    if (code !== "XX" && code !== "T1") return code;
  }
  return null;
}

function getIP(request) {
  return request.headers.get("CF-Connecting-IP") || "";
}

async function checkVPN(ip, apiKey) {
  if (!ip || !apiKey) return false;
  try {
    const res = await fetch(`https://proxycheck.io/v2/${ip}?key=${apiKey}&vpn=1`);
    const data = await res.json();
    return !!(data[ip] && data[ip].proxy === "yes");
  } catch {
    return false;
  }
}

function getPricing(countryCode) {
  if (!countryCode || countryCode === "IN") {
    return { currency: "INR", amount: 99900, display: "₹999" };
  }
  if (RICH_COUNTRIES.includes(countryCode)) {
    return { currency: "USD", amount: 2900, display: "$29" };
  }
  return { currency: "USD", amount: 1200, display: "$12" };
}

function isValidPayment(currency, amount) {
  return VALID_PRICES.some((p) => p.currency === currency && amount >= p.amount);
}

function pad(n, width = 2) {
  return n.toString().padStart(width, "0");
}

function randomChars(count) {
  const pool = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#*$@!%+";
  let result = "";
  for (let i = 0; i < count; i++) {
    result += pool.charAt(Math.floor(Math.random() * pool.length));
  }
  return result;
}

function generateAccessKey() {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const day = ist.getUTCDate();
  const minute = ist.getUTCMinutes();
  const hour24 = ist.getUTCHours();
  const year = ist.getUTCFullYear();

  const dayRev = parseInt(pad(day).split("").reverse().join(""));
  const dayCalc = dayRev + 12;

  const minFirstDigit = parseInt(pad(minute)[0]);
  const minCalc = minFirstDigit + 11;

  const yearRev = parseInt(pad(year % 100).split("").reverse().join(""));
  const yearCalc = yearRev - 2;

  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  const hourRev = parseInt(pad(hour12).split("").reverse().join(""));
  const hourCalc = pad(hourRev + 8, 2);

  return randomChars(3) + dayCalc + "7" + minCalc + "Jr" + "5" + yearCalc + randomChars(2) + "8" + hourCalc + "0";
}

async function detectRegion(request, env) {
  try {
    const country = getCountry(request);
    const isVPN = await checkVPN(getIP(request), env.PROXYCHECK_API_KEY);
    return json({ status: "ok", country, isVPN, ...getPricing(country) });
  } catch {
    return json({ status: "ok", country: "IN", isVPN: false, currency: "INR", amount: 99900, display: "₹999" });
  }
}

async function createOrder(request, env) {
  const country = getCountry(request);
  const isVPN = await checkVPN(getIP(request), env.PROXYCHECK_API_KEY);

  if (isVPN) {
    return json({
      status: "vpn_detected",
      message: "VPN or Proxy detected. Please turn off your VPN and try again.",
    });
  }

  const { currency, amount } = getPricing(country);
  const auth = btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET);

  const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + auth,
    },
    body: JSON.stringify({ amount, currency, payment_capture: 1 }),
  });

  const order = await orderRes.json();

  if (!orderRes.ok) {
    return json(
      { status: "error", message: order.error ? order.error.description : "Order creation failed" },
      500
    );
  }

  return json({
    status: "ok",
    orderId: order.id,
    keyId: env.RAZORPAY_KEY_ID,
    amount: order.amount,
    currency: order.currency,
  });
}

async function verifySignature(secret, body, signature) {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

async function webhook(request, env) {
  const bodyText = await request.text();
  const valid = await verifySignature(
    env.RAZORPAY_WEBHOOK_SECRET,
    bodyText,
    request.headers.get("x-razorpay-signature")
  );

  if (!valid) {
    return json({ status: "error", message: "Invalid signature" }, 400);
  }

  const body = JSON.parse(bodyText);

  if (body.event === "payment.captured" || body.event === "payment_link.paid") {
    const p = body.payload && body.payload.payment && body.payload.payment.entity;
    if (p && p.contact && isValidPayment(p.currency, p.amount)) {
      const phone = String(p.contact).replace(/[^0-9]/g, "").slice(-10);
      await env.DB.prepare(
        "INSERT OR REPLACE INTO payments (phone, paid_at, amount, currency, claimed) VALUES (?1, ?2, ?3, ?4, 0)"
      )
        .bind(phone, Date.now(), p.amount, p.currency)
        .run();
    }
  }

  return json({ status: "ok" });
}

async function getKey(request, env) {
  const body = await request.json().catch(() => ({}));
  const input = String(body.phone || "").trim();

  if (!input) {
    return json({ status: "error", message: "Phone number required" }, 400);
  }

  if (env.TEST_BYPASS_CODE && input === env.TEST_BYPASS_CODE) {
    return json({ status: "ok", accessKey: generateAccessKey(), downloadUrl: env.APK_DOWNLOAD_URL });
  }

  const phone = input.replace(/[^0-9]/g, "").slice(-10);

  const row = await env.DB.prepare("SELECT paid_at, claimed FROM payments WHERE phone = ?1")
    .bind(phone)
    .first();

  if (!row) return json({ status: "not_found" });
  if (row.claimed === 1) return json({ status: "claimed" });
  if (Date.now() - row.paid_at > DURATION_MS) return json({ status: "expired" });

  const upd = await env.DB.prepare("UPDATE payments SET claimed = 1 WHERE phone = ?1 AND claimed = 0")
    .bind(phone)
    .run();

  if (!upd.meta || upd.meta.changes !== 1) {
    return json({ status: "claimed" });
  }

  return json({ status: "ok", accessKey: generateAccessKey(), downloadUrl: env.APK_DOWNLOAD_URL });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    try {
      if (path === "/api/detect-region" && request.method === "GET") return await detectRegion(request, env);
      if (path === "/api/create-order" && request.method === "POST") return await createOrder(request, env);
      if (path === "/api/get-key" && request.method === "POST") return await getKey(request, env);
      if (path === "/api/webhook" && request.method === "POST") return await webhook(request, env);
    } catch (err) {
      return json({ status: "error", message: err.message }, 500);
    }

    return env.ASSETS.fetch(request);
  },
};
