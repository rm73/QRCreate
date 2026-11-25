const os = require("os");
const QRCode = require("qrcode");
const { imageHtmlLink } = require("./image-link");

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

function rankAddress(name, address) {
  const skip = /virtual|vbox|vmware|hyper-v|wsl|loopback|bluetooth|vethernet|npcap|tun|tap|docker/i;
  if (skip.test(name) || address.startsWith("169.254.")) return 100;
  const wifi = /wi-?fi|wlan|wireless/i.test(name);
  if (address.startsWith("192.168.") && wifi) return 0;
  if (address.startsWith("192.168.")) return 1;
  if (wifi) return 2;
  if (address.startsWith("10.")) return 3;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 4;
  return 40;
}

function lanIPv4() {
  const candidates = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const ip4 = entry.family === "IPv4" || entry.family === 4;
      if (!ip4 || entry.internal) continue;
      candidates.push({ address: entry.address, rank: rankAddress(name, entry.address) });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const chosen = candidates.find((item) => item.rank < 50);
  return chosen ? chosen.address : "";
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

  if (type === "image") return buildImagePayload(body || {});
  if (type === "gif") return buildGifPayload(body || {});

  throw new QrError(400, "Jenis QR tidak dikenali.");
}

function buildImagePayload(body) {
  let built;
  try {
    built = imageHtmlLink(decodeBase64(body.data), body.mime, body.filename, body.origin);
  } catch (error) {
    throw new QrError(error.status || 400, error.message);
  }
  if (built.bytes > LIMITS.L) {
    throw new QrError(
      413,
      `Kode HTML gambar ${built.bytes.toLocaleString("id-ID")} byte. Satu QR muat 2.953 byte.`,
      { bytes: built.bytes, limit: LIMITS.L }
    );
  }
  return { label: "Gambar", text: built.link, kind: "text" };
}

function buildGifPayload(body) {
  let origin = String(body.origin || "");
  try {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1") origin = reachableOrigin(origin);
  } catch (error) {
    origin = reachableOrigin(body.origin);
  }
  let built;
  try {
    built = imageHtmlLink(decodeBase64(body.data), body.mime, body.filename, origin, true);
  } catch (error) {
    throw new QrError(error.status || 400, error.message);
  }
  if (!built.link || built.bytes > LIMITS.L) {
    throw new QrError(
      413,
      `Kode HTML GIF ${built.bytes.toLocaleString("id-ID")} byte. Satu QR muat 2.953 byte.`,
      { bytes: built.bytes, limit: LIMITS.L }
    );
  }
  return { label: "GIF", text: built.link, kind: "text" };
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
    margin: 4,
    color: { dark: "#000000", light: "#ffffff" },
  };
  const [svg, png] = await Promise.all([
    QRCode.toString(segments, { ...options, type: "svg" }),
    QRCode.toDataURL(segments, { ...options, scale: 8 }),
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

module.exports = { createQr, LIMITS, reachableOrigin };
