module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ status: "error" });

  try {
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
        amount: 99900,
        currency: "INR",
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
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};
