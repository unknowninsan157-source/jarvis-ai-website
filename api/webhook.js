const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error" });
  }

  try {
    const signature = req.headers["x-razorpay-signature"];
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(400).json({ status: "error", message: "Invalid signature" });
    }

    const event = req.body.event;

    if (event === "payment_link.paid" || event === "payment.captured") {
      const paymentEntity =
        req.body.payload.payment && req.body.payload.payment.entity
          ? req.body.payload.payment.entity
          : null;

      if (paymentEntity) {
        const paidAt = Date.now();

        await db.collection("payments_by_id").doc(paymentEntity.id).set({
          paid: true,
          paidAt,
        });

        if (paymentEntity.contact) {
          let phone = paymentEntity.contact.replace(/[^0-9]/g, "").slice(-10);
          await db.collection("payments_by_phone").doc(phone).set({
            paid: true,
            paidAt,
          });
        }
      }
    }

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};
