const RICH_COUNTRIES = ["US", "GB", "RU", "CN", "JP"];

function getClientIP(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket ? req.socket.remoteAddress : "";
}

function getCountryFromHeaders(req) {
  const candidates = [req.headers["cf-ipcountry"], req.headers["x-vercel-ip-country"]];
  for (const c of candidates) {
    if (c && /^[A-Za-z]{2}$/.test(c)) {
      const code = c.toUpperCase();
      if (code !== "XX" && code !== "T1") return code;
    }
  }
  return null;
}

async function getCountryFromAPI(ip) {
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
    return { currency: "INR", amount: 99900, display: "₹999" };
  }
  if (RICH_COUNTRIES.includes(countryCode)) {
    return { currency: "USD", amount: 2900, display: "$29" };
  }
  return { currency: "USD", amount: 1200, display: "$12" };
}

module.exports = async (req, res) => {
  try {
    const ip = getClientIP(req);
    let countryCode = getCountryFromHeaders(req);
    if (!countryCode) countryCode = await getCountryFromAPI(ip);
    const isVPN = await checkVPN(ip);
    const pricing = getPricing(countryCode);

    return res.status(200).json({
      status: "ok",
      country: countryCode,
      isVPN,
      ...pricing,
    });
  } catch (err) {
    return res.status(200).json({
      status: "ok",
      country: "IN",
      isVPN: false,
      currency: "INR",
      amount: 99900,
      display: "₹999",
    });
  }
};
