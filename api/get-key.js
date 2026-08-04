const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

const DURATION_MS = 10 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function pad(n, width = 2) { return n.toString().padStart(width, "0"); }

function getISTParts() {
  const istTime = new Date(Date.now() + IST_OFFSET_MS);
  return {
    day: istTime.getUTCDate(),
    minute: istTime.getUTCMinutes(),
    hour24: istTime.getUTCHours(),
    year: istTime.getUTCFullYear(),
  };
}

function randomChars(count) {
  const pool = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#£$%^&*".split("");
  const emojis = ["😂", "🟢", "❌", "👍🏻", "💬", "👤", "✔️", "⚡"];
  let result = "";
  for (let i = 0; i < count; i++) {
    result += Math.random() < 0.3 ? emojis[Math.floor(Math.random() * emojis.length)] : pool[Math.floor(Math.random() * pool.length)];
  }
  return result;
}

function generateAccessKey() {
  const { day, minute, hour24, year } = getISTParts();

  const dayRev = parseInt(pad(day).split("").reverse().join(""));
  const dayCalc = dayRev + 12;

  const minFirstDigit = parseInt(pad(minute)[0]);
  const minCalc = minFirstDigit + 11;

  const yearRev = parseInt(pad(year % 100).split("").reverse().join(""));
  const yearCalc = yearRev - 2;

  let hour12 = hour24 % 12; if (hour12 === 0) hour12 = 12;
  const hourRev = parseInt(pad(hour12).split("").reverse().join(""));
  const hourCalc = pad(hourRev + 8, 2);

  return randomChars(3) + dayCalc + "7" + minCalc + "Jr" + "5" + yearCalc + randomChars(2) + "8" + hourCalc + "0";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ status: "error" });

  try {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ status: "error", message: "Phone number required" });

    const trimmedInput = phone.trim();

    // TEST MODE BYPASS: enter the secret test code instead of a phone number
    if (process.env.TEST_BYPASS_CODE && trimmedInput === process.env.TEST_BYPASS_CODE) {
      const accessKey = generateAccessKey();
      const downloadUrl = process.env.APK_DOWNLOAD_URL;
      return res.status(200).json({ status: "ok", accessKey, downloadUrl });
    }

    phone = trimmedInput.replace(/[^0-9]/g, "").slice(-10);

    const doc = await db.collection("payments_by_phone").doc(phone).get();
    if (!doc.exists || !doc.data().paid) {
      return res.status(200).json({ status: "not_found" });
    }

    const elapsed = Date.now() - doc.data().paidAt;
    if (elapsed > DURATION_MS) {
      return res.status(200).json({ status: "expired" });
    }

    const accessKey = generateAccessKey();
    const downloadUrl = process.env.APK_DOWNLOAD_URL;

    return res.status(200).json({ status: "ok", accessKey, downloadUrl });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};
