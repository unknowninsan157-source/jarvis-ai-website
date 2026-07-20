const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

function pad(n, width = 2) { return n.toString().padStart(width, "0"); }

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
  const now = new Date();
  const dayRev = parseInt(pad(now.getDate()).split("").reverse().join(""));
  const dayCalc = dayRev + 12;
  const minFirstDigit = parseInt(pad(now.getMinutes())[0]);
  const minCalc = minFirstDigit + 11;
  const yearRev = parseInt(pad(now.getFullYear() % 100).split("").reverse().join(""));
  const yearCalc = yearRev - 2;
  let hour12 = now.getHours() % 12; if (hour12 === 0) hour12 = 12;
  const hourRev = parseInt(pad(hour12).split("").reverse().join(""));
  const hourCalc = pad(hourRev + 8, 2);

  return randomChars(3) + dayCalc + "7" + minCalc + "Jr" + "5" + yearCalc + randomChars(2) + "8" + hourCalc + "0";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ status: "error" });

  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ status: "error" });

    const doc = await db.collection("payments_by_id").doc(paymentId).get();
    if (!doc.exists || !doc.data().paid) {
      return res.status(200).json({ status: "not_found" });
    }

    const accessKey = generateAccessKey();
    const file = bucket.file("jarvis-app.apk");
    const [downloadUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 10 * 60 * 1000,
    });

    return res.status(200).json({ status: "ok", accessKey, downloadUrl });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};
