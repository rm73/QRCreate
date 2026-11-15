const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "data", "files");
const MIME = {
  gif: "image/gif",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function saveFile(buffer, ext, downloadName) {
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomBytes(8).toString("hex");
  const stored = `${id}.${ext}`;
  fs.writeFileSync(path.join(dir, stored), buffer);
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      mime: MIME[ext],
      downloadName: safeName(downloadName, ext),
    })
  );
  return stored;
}

function openFile(storedName) {
  const base = path.basename(String(storedName || ""));
  const match = base.match(/^([a-f0-9]{16})\.(gif|svg|png|jpe?g|webp)$/i);
  if (!match) return null;
  const full = path.join(dir, `${match[1]}.${match[2].toLowerCase()}`);
  const metaPath = path.join(dir, `${match[1]}.json`);
  if (!fs.existsSync(full)) return null;
  const meta = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, "utf8"))
    : { mime: MIME[match[2].toLowerCase()], downloadName: base };
  return { buffer: fs.readFileSync(full), mime: meta.mime, downloadName: meta.downloadName };
}

function safeName(name, ext) {
  const cleaned = String(name || "hasil")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "hasil";
  return cleaned.toLowerCase().endsWith(`.${ext}`) ? cleaned : `${cleaned}.${ext}`;
}

module.exports = { saveFile, openFile };
