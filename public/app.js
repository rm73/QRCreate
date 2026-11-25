const LIMITS = { L: 2953, M: 2331, Q: 1663, H: 1273 };
const LEVEL_NAME = { H: "High", Q: "Quartile", M: "Medium", L: "Low" };
const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#d4ff5b"/><path d="M20 34l8 8 16-18" fill="none" stroke="#000" stroke-width="4"/></svg>`;
const SAMPLE_GIF = "R0lGODlhIAAgAIEAAAAAANT/W////xZC3SwAAAAAIAAgAIEAAADU/1v///8WQt0CVZSPqcvtD6OctNorg94aGw5uV0gGVVlOKJppAFC+IrS9MmjD3VPbYT5zcG4/3U64YvGSqSUzRHtCnYGc1RdEVq/WrJbbPUalp+co6RE00+y2+w2PwwsA";

const kind = document.body.dataset.kind;
if (kind) startGenerator(kind);

function startGenerator(kind) {
  const form = document.querySelector("#form");
  const formError = document.querySelector("#form-error");
  const meter = document.querySelector("#meter");
  const meterFill = document.querySelector("#meter-fill");
  const meterLabel = document.querySelector("#meter-label");
  const levelLabel = document.querySelector("#level-label");
  const qrStage = document.querySelector("#qr-stage");
  const meta = document.querySelector("#meta");
  const downloads = document.querySelector("#downloads");
  const decoded = document.querySelector("#decoded");
  const picked = { file: null, sample: false };
  let latest = null;
  let requestId = 0;

  if (kind === "wifi") {
    form.elements.security.addEventListener("change", () => {
      document.querySelector("#password-field").hidden = form.elements.security.value === "nopass";
      refreshMeter();
    });
    ["ssid", "password"].forEach((name) => form.elements[name].addEventListener("input", refreshMeter));
    form.elements.hidden.addEventListener("change", refreshMeter);
  }
  if (kind === "link") form.elements.url.addEventListener("input", refreshMeter);
  if (kind === "image" || kind === "gif") {
    bindDrop(kind);
    const replace = document.querySelector("#replace-file");
    const clear = document.querySelector("#clear-file");
    if (replace) replace.addEventListener("click", () => {
      const input = document.querySelector(`#${kind}-drop input`);
      input.value = "";
      input.click();
    });
    if (clear) clear.addEventListener("click", clearFile);
  }

  const sample = document.querySelector(kind === "gif" ? "#sample-gif" : "#sample-svg");
  if (sample) {
    sample.addEventListener("click", () => {
      picked.sample = true;
      picked.file = null;
      const src = kind === "gif"
        ? `data:image/gif;base64,${SAMPLE_GIF}`
        : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVG)}`;
      showDrop(kind, kind === "gif" ? "Contoh Gif" : "Contoh Gambar", src);
      refreshMeter();
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = ++requestId;
    formError.hidden = true;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const response = await fetch("/api/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await buildBody()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "QR gagal dibuat.");
      if (id !== requestId) return;
      latest = data;
      showResult(data);
    } catch (error) {
      if (id !== requestId) return;
      formError.textContent = error.message;
      formError.hidden = false;
    } finally {
      if (id === requestId) button.disabled = false;
    }
  });

  document.querySelector("#save-png").addEventListener("click", () => {
    if (latest) download(latest.png, `qr-${kind}.png`);
  });
  document.querySelector("#save-svg").addEventListener("click", () => {
    if (!latest) return;
    download(URL.createObjectURL(new Blob([latest.svg], { type: "image/svg+xml" })), `qr-${kind}.svg`);
  });

  function bindDrop(current) {
    const drop = document.querySelector(`#${current}-drop`);
    const input = drop.querySelector("input");
    input.addEventListener("change", () => {
      if (input.files && input.files[0]) setFile(input.files[0]);
    });
    ["dragenter", "dragover"].forEach((name) => {
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        drop.classList.add("drag");
      });
    });
    ["dragleave", "drop"].forEach((name) => {
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        drop.classList.remove("drag");
      });
    });
    drop.addEventListener("drop", (event) => {
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) setFile(file);
    });
  }

  function setFile(file) {
    picked.file = file;
    picked.sample = false;
    showDrop(kind, file.name, URL.createObjectURL(file));
    refreshMeter();
  }

  function showDrop(current, label, src) {
    const drop = document.querySelector(`#${current}-drop`);
    drop.classList.add("has-file");
    const name = drop.querySelector(".drop-name");
    name.hidden = false;
    name.textContent = label;
    const preview = drop.querySelector(".drop-preview");
    preview.hidden = false;
    preview.src = src;
    const actions = document.querySelector("#file-actions");
    if (actions) actions.hidden = false;
  }

  function clearFile() {
    picked.file = null;
    picked.sample = false;
    latest = null;
    const drop = document.querySelector(`#${kind}-drop`);
    const input = drop.querySelector("input");
    input.value = "";
    drop.classList.remove("has-file");
    const name = drop.querySelector(".drop-name");
    name.hidden = true;
    name.textContent = "";
    const preview = drop.querySelector(".drop-preview");
    if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
    preview.hidden = true;
    preview.removeAttribute("src");
    const actions = document.querySelector("#file-actions");
    if (actions) actions.hidden = true;
    const note = document.createElement("p");
    note.textContent = "QR muncul di sini";
    qrStage.replaceChildren(note);
    meta.hidden = true;
    downloads.hidden = true;
    decoded.hidden = true;
    decoded.replaceChildren();
    formError.hidden = true;
    refreshMeter();
  }

  async function measure() {
    if (kind === "link") return { bytes: utf8Size(normalizeUrl(form.elements.url.value)), fileBytes: 0 };
    if (kind === "wifi") return { bytes: utf8Size(wifiText()), fileBytes: 0 };
    const file = await currentFile();
    if (!file) return { bytes: 0, fileBytes: 0 };
    if ((kind === "image" || kind === "gif") && typeof imageHtmlLink === "function") {
      try {
        const origin = kind === "gif" ? await scanHost() : location.origin;
        const built = imageHtmlLink(file.binary, file.mime, file.name, origin, kind === "gif");
        return { bytes: built.bytes, fileBytes: file.bytes };
      } catch (error) {
        return { bytes: LIMITS.L + 1, fileBytes: file.bytes };
      }
    }
    const origin = await scanHost();
    return {
      bytes: utf8Size(`${origin}/file/${"a".repeat(16)}.gif`),
      fileBytes: file.bytes,
    };
  }

  async function refreshMeter() {
    const { bytes, fileBytes } = await measure();
    const level = levelFor(bytes);
    const ratio = Math.min(bytes / LIMITS.L, 1);
    meterFill.style.width = `${bytes > 0 ? Math.max(ratio * 100, 1.5) : 0}%`;
    meter.classList.toggle("over", bytes > LIMITS.L);
    levelLabel.textContent = `Level Error Correction: ${LEVEL_NAME[level] || "—"}`;
    const fileNote = fileBytes ? `berkas ${fileBytes.toLocaleString("id-ID")} byte · ` : "";
    meterLabel.textContent = `${fileNote}${bytes.toLocaleString("id-ID")} / ${LIMITS.L.toLocaleString("id-ID")} byte`;
    document.querySelectorAll(".tick").forEach((tick) => {
      tick.classList.toggle("on", tick.dataset.level === level);
    });
  }

  async function buildBody() {
    const body = { type: kind, origin: location.origin };
    if (kind === "link") {
      body.url = form.elements.url.value.trim();
      return body;
    }
    if (kind === "wifi") {
      body.ssid = form.elements.ssid.value;
      body.password = form.elements.password.value;
      body.security = form.elements.security.value;
      body.hidden = form.elements.hidden.checked;
      return body;
    }
    const file = await currentFile();
    if (!file) throw new Error(kind === "gif" ? "Pilih berkas GIF." : "Pilih berkas gambar.");
    body.filename = file.name;
    body.mime = file.mime;
    body.data = window.btoa(asLatin1(file.binary));
    return body;
  }

  async function currentFile() {
    if (picked.sample && kind === "image") {
      return { name: "contoh.svg", mime: "image/svg+xml", binary: SAMPLE_SVG, bytes: utf8Size(SAMPLE_SVG) };
    }
    if (picked.sample && kind === "gif") {
      const bytes = Uint8Array.from(atob(SAMPLE_GIF), (char) => char.charCodeAt(0));
      return { name: "contoh.gif", mime: "image/gif", binary: latin1(bytes), bytes: bytes.length };
    }
    if (!picked.file) return null;
    const bytes = new Uint8Array(await picked.file.arrayBuffer());
    return {
      name: picked.file.name,
      mime: picked.file.type || (kind === "gif" ? "image/gif" : "application/octet-stream"),
      binary: latin1(bytes),
      bytes: bytes.length,
    };
  }

  function showResult(data) {
    qrStage.replaceChildren();
    const image = document.createElement("img");
    image.src = data.png;
    image.alt = `QR ${data.label}`;
    qrStage.append(image);
    meta.hidden = false;
    meta.textContent = `${data.label} · versi ${data.version} · ${LEVEL_NAME[data.level] || data.level} · ${data.bytes.toLocaleString("id-ID")} / ${LIMITS.L.toLocaleString("id-ID")} byte`;
    downloads.hidden = false;
    renderDecoded(data);
  }

  function renderDecoded(data) {
    decoded.hidden = false;
    decoded.replaceChildren();
    if (data.wifi) {
      const note = document.createElement("p");
      const security = data.wifi.security === "nopass" ? "tanpa sandi" : data.wifi.security;
      note.textContent = `Jaringan ${data.wifi.ssid} · ${security}${data.wifi.hidden ? " · tersembunyi" : ""}`;
      decoded.append(note);
      return;
    }
    const preview = data.preview || "";
    if (data.file && data.file.href) {
      const visual = document.createElement("img");
      visual.alt = data.label;
      visual.src = data.file.href;
      const note = document.createElement("p");
      note.textContent = `HP membuka ${preview}`;
      decoded.append(visual, note);
      return;
    }
    const page = htmlFromLink(preview);
    if (page) {
      const frame = document.createElement("iframe");
      frame.sandbox = "";
      frame.title = data.label;
      frame.srcdoc = page;
      const link = document.createElement("a");
      link.href = preview;
      link.textContent = preview;
      link.target = "_blank";
      link.rel = "noreferrer";
      const note = document.createElement("p");
      note.textContent = "Ketuk tautan ini di HP.";
      note.append(document.createElement("br"), link);
      decoded.append(frame, note);
      return;
    }
    if (preview.startsWith("http://") || preview.startsWith("https://")) {
      const link = document.createElement("a");
      link.href = preview;
      link.textContent = preview;
      link.target = "_blank";
      link.rel = "noreferrer";
      const note = document.createElement("p");
      note.append(link);
      decoded.append(note);
    }
  }

  function htmlFromLink(link) {
  try {
    if (link.startsWith("data:text/html")) {
      const comma = link.indexOf(",");
      const meta = link.slice(0, comma);
      const data = link.slice(comma + 1);
      const bytes = meta.includes(";base64")
        ? Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(data));
      return new TextDecoder().decode(bytes);
    }
    const url = new URL(link);
    const code = url.searchParams.get("d") || (url.hash.length > 1 ? decodeURIComponent(url.hash.slice(1)) : "");
    if (!code || !/\/v$/.test(url.pathname)) return "";
    const pad = code.length % 4 ? "=".repeat(4 - (code.length % 4)) : "";
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (char) => char.charCodeAt(0)));
  } catch (error) {
    return "";
  }
}

function download(href, name) {
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.click();
  }

  function normalizeUrl(value) {
    const url = value.trim();
    if (!url || /\s/.test(url)) return url;
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  }

  function wifiText() {
    const security = form.elements.security.value;
    const password = security === "nopass" ? "" : form.elements.password.value;
    return `WIFI:T:${security};S:${escapeWifi(form.elements.ssid.value.trim())};P:${escapeWifi(password)};H:${form.elements.hidden.checked ? "true" : "false"};;`;
  }

  refreshMeter();
}

let scanOrigin = "";

async function scanHost() {
  if (scanOrigin) return scanOrigin;
  try {
    const response = await fetch("/api/reach");
    const data = await response.json();
    if (response.ok && data.origin) {
      scanOrigin = data.origin;
      return scanOrigin;
    }
  } catch (error) {
    scanOrigin = "";
  }
  return location.origin;
}

function levelFor(bytes) {
  if (bytes <= LIMITS.H) return "H";
  if (bytes <= LIMITS.Q) return "Q";
  if (bytes <= LIMITS.M) return "M";
  if (bytes <= LIMITS.L) return "L";
  return "";
}

function escapeWifi(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/([;,:"])/g, "\\$1");
}

function utf8Size(value) {
  return new TextEncoder().encode(value).length;
}

function asLatin1(value) {
  if (typeof value !== "string") return latin1(value);
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 255) return latin1(new TextEncoder().encode(value));
  }
  return value;
}

function latin1(bytes) {
  let text = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return text;
}
