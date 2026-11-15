const path = require("path");
const express = require("express");
const { createQr } = require("./lib/qr");
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
  app.listen(port, () => {
    console.log(`QR generator siap di http://localhost:${port}`);
  });
}

module.exports = app;
