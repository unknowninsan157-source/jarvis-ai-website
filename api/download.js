const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

const DURATION_MS = 10 * 60 * 1000;

module.exports = async (req, res) => {
  try {
    let phone = req.query.phone;
    if (!phone) return res.status(400).send("Missing phone number");
    phone = phone.replace(/[^0-9]/g, "").slice(-10);

    const doc = await db.collection("payments_by_phone").doc(phone).get();
    if (!doc.exists || !doc.data().paid) {
      return res.status(403).send("Payment not verified");
    }

    const elapsed = Date.now() - doc.data().paidAt;
    if (elapsed > DURATION_MS) {
      return res.status(403).send("Access window expired");
    }

    const blobRes = await fetch(process.env.APK_BLOB_URL, {
      headers: { Authorization: "Bearer " + process.env.BLOB_READ_WRITE_TOKEN }
    });

    if (!blobRes.ok) {
      return res.status(500).send("Failed to fetch file");
    }

    const arrayBuffer = await blobRes.arrayBuffer();
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="jarvis-app.apk"');
    return res.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    return res.status(500).send("Server error: " + err.message);
  }
};
