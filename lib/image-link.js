const OPEN = '<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;background:#fff">';
const PUBLIC_VIEWER = "";

function imageHtmlLink(input, mime, name, origin) {
  const bytes = toBytes(input);
  if (!bytes.length) fail(400, "Berkas kosong.");
  const viewer = viewerOrigin(origin);
  const prefix = `${viewer}/v#`;

  const type = String(mime || "").toLowerCase();
  const filename = String(name || "");
  const head = new TextDecoder().decode(bytes.subarray(0, 256));
  const looksSvg = type === "image/svg+xml" || /\.svg$/i.test(filename) || head.includes("<svg");
  const html = looksSvg ? `${OPEN}${svgMarkup(bytes)}` : `${OPEN}${rasterMarkup(bytes, type, filename)}`;
  const htmlBytes = new TextEncoder().encode(html).length;
  const linkBytes = new TextEncoder().encode(prefix).length + base64UrlLength(htmlBytes);
  if (linkBytes > 2953) return { link: "", bytes: linkBytes, html };
  const code = bytesToBase64(new TextEncoder().encode(html)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return { link: `${prefix}${code}`, bytes: linkBytes, html };
}

function base64UrlLength(size) {
  if (size <= 0) return 0;
  return Math.ceil(size / 3) * 4 - ((3 - (size % 3)) % 3);
}

function viewerOrigin(origin) {
  let url = null;
  try {
    url = new URL(String(origin || ""));
  } catch (error) {
    url = null;
  }
  if (url && (url.protocol === "http:" || url.protocol === "https:") && !isPrivateHost(url.hostname)) {
    return url.origin;
  }
  if (PUBLIC_VIEWER) return PUBLIC_VIEWER;
  fail(400, "Tautan gambar tidak memakai localhost. HP hanya bisa mengetuk tautan https publik.");
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return host.endsWith(".local");
}

function svgMarkup(bytes) {
  const text = new TextDecoder().decode(bytes)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/>\s+</g, "><")
    .trim();
  if (!text.includes("<svg")) fail(400, "SVG tidak valid.");
  return text.replace(/<svg\b([^>]*)>/i, (match, attrs) => (
    /\bwidth\s*=/.test(attrs) ? match : `<svg${attrs} width="100%">`
  ));
}

function rasterMarkup(bytes, mime, name) {
  const type = rasterType(bytes, mime, name);
  if (!type) fail(400, "Gunakan SVG, PNG, JPEG, atau WebP.");
  return `<img alt="" style="width:100%;height:100vh;object-fit:contain" src="data:${type};base64,${bytesToBase64(bytes)}">`;
}

function rasterType(bytes, mime, name) {
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") return mime;
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.png$/i.test(name)) return "image/png";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  return "";
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  const text = String(input || "");
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 255;
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x4000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

const api = { imageHtmlLink };
if (typeof module === "object" && module.exports) module.exports = api;
if (typeof globalThis !== "undefined") globalThis.imageHtmlLink = imageHtmlLink;
