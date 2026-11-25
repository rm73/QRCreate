const path = require("path");
const express = require("express");
const { createQr, reachableOrigin } = require("./lib/qr");
const { openFile } = require("./lib/files");

const app = express();

app.use(express.json({ limit: "8mb" }));

app.post("/api/qr", async (req, res) => {
  try {
    const result = await createQr(req.body || {});
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: status === 500 ? "QR gagal dibuat." : error.message,
      bytes: error.bytes,
      limit: error.limit,
    });
  }
});

app.get("/api/reach", (req, res) => {
  try {
    const host = req.get("origin") || `${req.protocol}://${req.get("host")}`;
    res.json({ origin: reachableOrigin(host) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/file/:name", (req, res) => {
  const file = openFile(req.params.name);
  if (!file) {
    res.status(404).type("text/plain").send("Berkas tidak ditemukan.");
    return;
  }
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Disposition", `inline; filename="${file.downloadName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(file.buffer);
});

app.get("/v", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "v.html"));
});

app.get("/image-link.js", (req, res) => {
  res.type("application/javascript").sendFile(path.join(__dirname, "lib", "image-link.js"));
});

app.get(["/link", "/wifi", "/image", "/gif"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", `${req.path.slice(1)}.html`));
});

app.use((error, req, res, next) => {
  if (error && error.type === "entity.too.large") {
    res.status(413).json({ error: "Berkas maksimal 5 MB." });
    return;
  }
  next(error);
});

app.use(express.static(path.join(__dirname, "public")));

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    let phone = "";
    try {
      phone = reachableOrigin(`http://localhost:${port}`);
    } catch (error) {
      phone = "";
    }
    console.log(phone ? `QRku siap di http://localhost:${port} · HP ${phone}` : `QRku siap di http://localhost:${port}`);
  });
}

module.exports = app;
