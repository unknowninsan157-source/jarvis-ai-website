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
    const countryCode = await getCountryCode(ip);
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
