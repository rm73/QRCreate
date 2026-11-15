const os = require("os");
const QRCode = require("qrcode");
const { saveFile } = require("./files");

const LIMITS = { L: 2953, M: 2331, Q: 1663, H: 1273 };

class QrError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function escapeWifi(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/([;,:"])/g, "\\$1");
}

function minifySvg(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/>\s+</g, "><")
    .trim();
}

function decodeBase64(value) {
  const source = String(value || "").replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (!source || !/^[a-z0-9+/]+={0,2}$/i.test(source)) {
    throw new QrError(400, "Berkas tidak bisa dibaca.");
  }
  return Buffer.from(source, "base64");
}

function levelFor(bytes) {
  if (bytes <= LIMITS.H) return "H";
  if (bytes <= LIMITS.Q) return "Q";
  if (bytes <= LIMITS.M) return "M";
  if (bytes <= LIMITS.L) return "L";
  return "";
}

function safeOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function lanIPv4() {
  const skip = /virtual|vbox|vmware|hyper-v|wsl|loopback|bluetooth|vethernet|npcap|tun|tap|docker/i;
  const preferred = [];
  const rest = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const ip4 = entry.family === "IPv4" || entry.family === 4;
      if (!ip4 || entry.internal) continue;
      (skip.test(name) ? rest : preferred).push(entry.address);
    }
  }
  return preferred[0] || rest[0] || "";
}

function reachableOrigin(value) {
  const origin = safeOrigin(value);
  if (!origin) throw new QrError(400, "Alamat situs tidak dikenali.");
  const url = new URL(origin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    const ip = lanIPv4();
    if (!ip) throw new QrError(400, "Alamat Wi-Fi komputer tidak ditemukan. HP tidak bisa membuka localhost.");
    url.hostname = ip;
  }
  return url.origin;
}

function buildPayload(body) {
  const type = body && body.type;

  if (type === "link") {
    let url = String((body && body.url) || "").trim();
    if (!url) throw new QrError(400, "Isi tautan terlebih dahulu.");
    if (/\s/.test(url)) throw new QrError(400, "Tautan tidak boleh mengandung spasi.");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new QrError(400, "Tautan tidak valid.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new QrError(400, "Gunakan tautan http atau https.");
    }
    return { label: "Tautan", text: parsed.href, kind: "text" };
  }

  if (type === "wifi") {
    const ssid = String((body && body.ssid) || "").trim();
    if (!ssid) throw new QrError(400, "Nama jaringan wajib diisi.");
    const security = ["WPA", "WEP", "nopass"].includes(body.security) ? body.security : "WPA";
    const password = String((body && body.password) || "");
    if (security !== "nopass" && password.length === 0) {
      throw new QrError(400, "Isi kata sandi, atau pilih tanpa sandi.");
    }
    const text = `WIFI:T:${security};S:${escapeWifi(ssid)};P:${security === "nopass" ? "" : escapeWifi(password)};H:${body.hidden ? "true" : "false"};;`;
    return {
      label: "Wi-Fi",
      text,
      kind: "text",
      wifi: { ssid, security, hidden: Boolean(body.hidden) },
    };
  }

  if (type === "image" || type === "gif") {
    return buildFilePayload(body || {}, type);
  }

  throw new QrError(400, "Jenis QR tidak dikenali.");
}

function buildFilePayload(body, type) {
  const mime = String(body.mime || "").toLowerCase();
  const name = String(body.filename || "berkas");
  const raw = decodeBase64(body.data);
  if (!raw.length) throw new QrError(400, "Berkas kosong.");

  const head = raw.subarray(0, 256).toString("utf8");
  const looksSvg = mime === "image/svg+xml" || /\.svg$/i.test(name) || head.includes("<svg");
  const gifMagic = raw.subarray(0, 6).toString("ascii");
  const looksGif = mime === "image/gif" || /\.gif$/i.test(name) || gifMagic === "GIF87a" || gifMagic === "GIF89a";

  if (type === "gif" && !looksGif) {
    throw new QrError(400, "Berkas GIF tidak valid. Unggah file .gif.");
  }
  if (type === "image" && looksGif) {
    throw new QrError(400, "Untuk animasi, pilih jenis GIF.");
  }
  if (type === "image" && !looksSvg && !["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    throw new QrError(400, "Gunakan SVG, PNG, JPEG, atau WebP.");
  }

  if (raw.length > 5 * 1024 * 1024) {
    throw new QrError(413, "Berkas maksimal 5 MB.");
  }
  const origin = reachableOrigin(body.origin);

  if (looksSvg) {
    const text = minifySvg(raw.toString("utf8"));
    if (!text.includes("<svg")) throw new QrError(400, "SVG tidak valid.");
    const stored = saveFile(Buffer.from(text), "svg", name);
    return {
      label: "Gambar",
      text: `${origin}/file/${stored}`,
      kind: "text",
      file: { name, mime: "image/svg+xml", href: `/file/${stored}`, rawBytes: Buffer.byteLength(text, "utf8") },
    };
  }

  const fileMime = looksGif ? "image/gif" : mime;
  const ext = looksGif ? "gif" : fileMime === "image/jpeg" ? "jpg" : fileMime === "image/webp" ? "webp" : "png";
  const stored = saveFile(raw, ext, name);
  return {
    label: type === "gif" ? "GIF" : "Gambar",
    text: `${origin}/file/${stored}`,
    kind: "text",
    file: { name, mime: fileMime, href: `/file/${stored}`, rawBytes: raw.length },
  };
}

function segmentsFor(payload) {
  if (payload.kind === "byte") {
    return [{ data: payload.buffer, mode: "byte" }];
  }
  return payload.text;
}

async function createQr(body) {
  const payload = buildPayload(body);
  const segments = segmentsFor(payload);
  const bytes = payload.kind === "byte"
    ? payload.buffer.length
    : Buffer.byteLength(payload.text, "utf8");
  const level = levelFor(bytes);
  if (!level) {
    throw new QrError(
      413,
      `Isi ${bytes.toLocaleString("id-ID")} byte. Batas sebuah QR adalah 2.953 byte.`,
      { bytes, limit: LIMITS.L }
    );
  }
  payload.level = level;

  let symbol;
  try {
    symbol = QRCode.create(segments, { errorCorrectionLevel: level });
  } catch (error) {
    if (error && /too big/i.test(error.message || "")) {
      throw new QrError(
        413,
        `Isi ${bytes.toLocaleString("id-ID")} byte. Batas sebuah QR adalah 2.953 byte.`,
        { bytes, limit: LIMITS.L }
      );
    }
    throw error;
  }

  const options = {
    errorCorrectionLevel: payload.level,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  };
  const [svg, png] = await Promise.all([
    QRCode.toString(segments, { ...options, type: "svg" }),
    QRCode.toDataURL(segments, { ...options, width: 640 }),
  ]);

  return {
    svg,
    png,
    version: symbol.version,
    level: payload.level,
    bytes,
    limit: LIMITS[payload.level],
    label: payload.label,
    kind: payload.kind,
    preview: payload.kind === "text" ? payload.text : null,
    file: payload.file || null,
    wifi: payload.wifi || null,
  };
}

module.exports = { createQr, LIMITS };
