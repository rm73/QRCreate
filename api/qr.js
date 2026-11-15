const { createQr } = require("../lib/qr");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const result = await createQr(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: status === 500 ? "QR gagal dibuat." : error.message,
      bytes: error.bytes,
      limit: error.limit,
    });
  }
};
