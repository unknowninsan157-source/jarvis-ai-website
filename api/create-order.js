const RICH_COUNTRIES = ["US", "GB", "RU", "CN", "JP"];

function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket ? req.socket.remoteAddress : "";
}

async function getCountryCode(ip) {
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JarvisAI/1.0)" },
    });
    const data = await res.json();
    if (data.error) return null;
    return data.country_code || null;
  } catch {
    return null;
  }
}

async function checkVPN(ip) {
  try {
    const res = await fetch(
      `https://proxycheck.io/v2/${ip}?key=${process.env.PROXYCHECK_API_KEY}&vpn=1`
    );
    const data = await res.json();
    return data[ip] && data[ip].proxy === "yes";
  } catch {
    return false;
  }
}

function getPricing(countryCode) {
  if (!countryCode || countryCode === "IN") {
    return { currency: "INR", amount: 99900 };
  }
  if (RICH_COUNTRIES.includes(countryCode)) {
    return { currency: "USD", amount: 2900 };
  }
  return { currency: "USD", amount: 1200 };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ status: "error" });

  try {
    const ip = getClientIP(req);
    const countryCode = await getCountryCode(ip);
    const isVPN = await checkVPN(ip);

    if (isVPN) {
      return res.status(200).json({
        status: "vpn_detected",
        message: "VPN or Proxy detected. Please turn off your VPN and try again.",
      });
    }

    const { currency, amount } = getPricing(countryCode);

    const auth = Buffer.from(
      process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET
    ).toString("base64");

    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + auth,
      },
      body: JSON.stringify({
        amount,
        currency,
        payment_capture: 1,
      }),
    });

    const order = await orderRes.json();

    if (!orderRes.ok) {
      return res.status(500).json({
        status: "error",
        message: order.error ? order.error.description : "Order creation failed",
      });
    }

    return res.status(200).json({
      status: "ok",
      orderId: order.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};
