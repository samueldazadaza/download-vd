#!/usr/bin/env node
/**
 * Vivotek NVR NV9411P-A – Descargador automático de video
 * ─────────────────────────────────────────────────────────
 * Uso:
 *   node vivotek-download.js              → usa jobs.json
 *   node vivotek-download.js mi-jobs.json → usa otro archivo
 *
 * TIPOS DE BUS:
 *   "tipo_bus": "BUSETON"  → usa mapa de cámaras Buseton
 *   "tipo_bus": "PADRON"   → usa mapa de cámaras Padrón
 *
 * CÁMARAS — puedes especificarlas de 3 formas:
 *
 *   1. Por sigla:   "camaras": ["BSF", "BSO", "BS1"]
 *   2. Por número:  "camaras": [0, 1, 2, 5, 6]
 *   3. Todas:       "camaras": "TODAS"
 *
 * Tabla de cámaras:
 *   Canal │ BUSETON │ PADRÓN
 *   ──────┼─────────┼───────
 *     0   │ BSF     │ PDF    (Frontal)
 *     1   │ BSO     │ PDO    (Operador)
 *     2   │ BS1     │ PD1    (Interna 1)
 *     3   │  —      │ PD2    (Interna 2)
 *     4   │  —      │ PD3    (Interna 3)
 *     5   │ BS2     │ PD4    (Interna 2/4)
 *     6   │ BST     │ PDT    (Trasera)
 *
 * jobs.json ejemplo:
 * [
 *   {
 *     "descripcion":      "COMUNICADOS",
 *     "bus_id":           "Z67-4069",
 *     "tipo_bus":         "BUSETON",
 *     "nvr_user":         "admin",
 *     "nvr_pass":         "tu_contraseña",
 *     "fecha":            "2026-05-07",
 *     "hora_inicio":      "09:21:00",
 *     "duracion_minutos": 5,
 *     "formato":          "3gp",
 *     "camaras":          ["BSF", "BSO", "BS1", "BS2", "BST"]
 *   },
 *   {
 *     "descripcion":      "INCIDENTE",
 *     "bus_id":           "Z63-4034",
 *     "tipo_bus":         "PADRON",
 *     "nvr_user":         "admin",
 *     "nvr_pass":         "tu_contraseña",
 *     "fecha":            "2026-05-17",
 *     "hora_inicio":      "22:00:00",
 *     "duracion_minutos": 5,
 *     "formato":          "3gp",
 *     "camaras":          "TODAS"
 *   }
 * ]
 */

const fs   = require("fs");
const path = require("path");
const http = require("http");
// ══════════════════════════════════════════════════════════
// LECTOR DE JOBS (CSV o JSON)
// ══════════════════════════════════════════════════════════

/**
 * Parsea un CSV con separador ; y devuelve array de objetos.
 * Soporta campos entre comillas con comas internas: "5,6"
 * La primera fila debe ser el header.
 */
function parseCSV(content) {
  const lines  = content.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("#"));
  if (lines.length < 2) throw new Error("El CSV debe tener al menos una fila de header y una de datos.");

  const headers = splitCSVLine(lines[0]);
  const jobs    = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    if (values.length === 0) continue;

    const job = {};
    headers.forEach((h, idx) => {
      job[h.trim()] = (values[idx] || "").trim();
    });

    // Convertir tipos
    if (job.duracion_minutos) job.duracion_minutos = parseInt(job.duracion_minutos, 10);

    // Convertir camaras: "5,6" → [5,6] | "BSF,BSO" → ["BSF","BSO"] | "TODAS" → "TODAS"
    if (job.camaras) {
      const raw = job.camaras.replace(/^"|"$/g, "").trim(); // quitar comillas externas
      if (raw.toUpperCase() === "TODAS") {
        job.camaras = "TODAS";
      } else {
        job.camaras = raw.split(",").map(c => {
          const t = c.trim();
          // Si es número → número, si es sigla → string
          return /^\d+$/.test(t) ? parseInt(t, 10) : t;
        });
      }
    }

    jobs.push(job);
  }
  return jobs;
}

/**
 * Divide una línea CSV por ; respetando campos entre comillas.
 */
function splitCSVLine(line) {
  const fields = [];
  let current  = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ";" && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Carga jobs desde .csv o .json automáticamente según extensión.
 */
function loadJobs(filePath) {
  const ext     = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf8");

  if (ext === ".csv") {
    return parseCSV(content);
  } else {
    const jobs = JSON.parse(content);
    return Array.isArray(jobs) ? jobs : [jobs];
  }
}




// ══════════════════════════════════════════════════════════
// SISTEMA DE LOGS
// ══════════════════════════════════════════════════════════

const LOG_FILE = path.join(__dirname, "logs.csv");

/**
 * Inicializa el archivo de log con header si no existe.
 */
function initLog() {
  if (!fs.existsSync(LOG_FILE)) {
    const header = [
      "fecha_descarga",
      "hora_descarga",
      "bus_id",
      "tipo_bus",
      "descripcion",
      "nvr_ip",
      "fecha_video",
      "hora_video",
      "duracion_minutos",
      "canal",
      "camara_label",
      "chunk",
      "total_chunks",
      "estado",
      "archivo",
      "error"
    ].join(";");
    fs.writeFileSync(LOG_FILE, header + "\n", "utf8");
  }
}

/**
 * Escribe una entrada en el log.
 */
function writeLog(entry) {
  const now      = new Date();
  const fecha    = now.toISOString().slice(0, 10);
  const hora     = now.toTimeString().slice(0, 8);

  const row = [
    fecha,
    hora,
    entry.bus_id       || "",
    entry.tipo_bus     || "",
    entry.descripcion  || "",
    entry.nvr_ip       || "",
    entry.fecha_video  || "",
    entry.hora_video   || "",
    entry.duracion_min || "",
    entry.canal        !== undefined ? entry.canal : "",
    entry.camara_label || "",
    entry.chunk        || "",
    entry.total_chunks || "",
    entry.estado       || "",
    entry.archivo      ? `"${entry.archivo}"` : "",
    entry.error        ? `"${String(entry.error).replace(/"/g, "'")}"` : "",
  ].join(";");

  fs.appendFileSync(LOG_FILE, row + "\n", "utf8");
}

// ══════════════════════════════════════════════════════════
// MAPA DE CÁMARAS POR TIPO DE BUS
// ══════════════════════════════════════════════════════════

const CAMERA_MAP = {
  BUSETON: {
    // sigla → canal
    BSF: 0,   // Frontal
    BSO: 1,   // Operador
    BS1: 2,   // Interna 1
    BS2: 5,   // Interna 2
    BST: 6,   // Trasera
    // canales disponibles en este tipo
    _todos: [0, 1, 2, 5, 6],
  },
  PADRON: {
    // sigla → canal
    PDF: 0,   // Frontal
    PDO: 1,   // Operador
    PD1: 2,   // Interna 1
    PD2: 3,   // Interna 2
    PD3: 4,   // Interna 3
    PD4: 5,   // Interna 4
    PDT: 6,   // Trasera
    // canales disponibles en este tipo
    _todos: [0, 1, 2, 3, 4, 5, 6],
  },
};

// Etiqueta legible por canal y tipo de bus
const CAMERA_LABEL = {
  BUSETON: {
    0: "BSF – Frontal",
    1: "BSO – Operador",
    2: "BS1 – Interna 1",
    5: "BS2 – Interna 2",
    6: "BST – Trasera",
  },
  PADRON: {
    0: "PDF – Frontal",
    1: "PDO – Operador",
    2: "PD1 – Interna 1",
    3: "PD2 – Interna 2",
    4: "PD3 – Interna 3",
    5: "PD4 – Interna 4",
    6: "PDT – Trasera",
  },
  // Fallback genérico si no hay tipo_bus
  GENERICO: {
    0: "Frontal",
    1: "Operador",
    2: "Interna 1",
    3: "Interna 2",
    4: "Interna 3",
    5: "Interna 4",
    6: "Trasera",
    7: "Canal 8",
  },
};

/**
 * Resuelve la lista de canales numéricos a partir de:
 *   - "TODAS"         → todos los canales del tipo de bus
 *   - ["BSF", "BS1"]  → siglas del tipo de bus → canales
 *   - [0, 2, 5]       → canales numéricos directos
 *   - mezcla          → ["BSF", 5, "BST"] también funciona
 *
 * @param {string|Array} camaras
 * @param {string} tipo_bus  "BUSETON" | "PADRON" | undefined
 * @returns {number[]} lista de canales
 */
function resolveCanales(camaras, tipo_bus) {
  const tipoBusKey = (tipo_bus || "").toUpperCase();
  const mapa       = CAMERA_MAP[tipoBusKey] || null;

  // "TODAS" → canales del tipo de bus o error
  if (camaras === "TODAS" || camaras === "todas") {
    if (!mapa) throw new Error(
      `"camaras": "TODAS" requiere definir "tipo_bus" (BUSETON o PADRON).`
    );
    return [...mapa._todos];
  }

  if (!Array.isArray(camaras) || camaras.length === 0)
    throw new Error(`"camaras" debe ser un array o "TODAS". Recibido: ${JSON.stringify(camaras)}`);

  const canales = [];
  for (const cam of camaras) {
    if (typeof cam === "number") {
      // Canal numérico directo
      if (!Number.isInteger(cam) || cam < 0)
        throw new Error(`Canal inválido: ${cam}`);
      canales.push(cam);
    } else if (typeof cam === "string") {
      const sigla = cam.toUpperCase();
      if (!mapa) throw new Error(
        `Usaste sigla "${cam}" pero no definiste "tipo_bus" (BUSETON o PADRON).`
      );
      if (mapa[sigla] === undefined) throw new Error(
        `Sigla "${cam}" no existe para tipo_bus "${tipoBusKey}".\n` +
        `  Siglas válidas: ${Object.keys(mapa).filter(k => !k.startsWith("_")).join(", ")}`
      );
      canales.push(mapa[sigla]);
    } else {
      throw new Error(`Valor inválido en "camaras": ${JSON.stringify(cam)}`);
    }
  }

  // Eliminar duplicados manteniendo orden
  return [...new Set(canales)];
}

/**
 * Devuelve la etiqueta legible de un canal según el tipo de bus.
 */
function getCameraLabel(channel, tipo_bus) {
  const tipoBusKey = (tipo_bus || "").toUpperCase();
  const labels     = CAMERA_LABEL[tipoBusKey] || CAMERA_LABEL.GENERICO;
  return labels[channel] || `Canal ${channel}`;
}

// ══════════════════════════════════════════════════════════
// RSA IMPLEMENTATION
// Portado directamente del código fuente del NVR Vivotek
// ══════════════════════════════════════════════════════════

function BigInteger(a, b, c) {
  if (a != null) {
    if ("number" == typeof a) this.fromNumber(a, b, c);
    else if (b == null && "string" != typeof a) this.fromString(a, 256);
    else this.fromString(a, b);
  }
}
function nbi() { return new BigInteger(null); }

function am3(i, x, w, j, c, n) {
  var xl = x & 0x3fff, xh = x >> 14;
  while (--n >= 0) {
    var l = this[i] & 0x3fff, h = this[i++] >> 14;
    var m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + w[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    w[j++] = l & 0xfffffff;
  }
  return c;
}
BigInteger.prototype.am = am3;
var dbits = 28;
BigInteger.prototype.DB = dbits;
BigInteger.prototype.DM = ((1 << dbits) - 1);
BigInteger.prototype.DV = (1 << dbits);
var BI_FP = 52;
BigInteger.prototype.FV = Math.pow(2, BI_FP);
BigInteger.prototype.F1 = BI_FP - dbits;
BigInteger.prototype.F2 = 2 * dbits - BI_FP;

var BI_RM = "0123456789abcdefghijklmnopqrstuvwxyz";
var BI_RC = [];
var rr, vv;
rr = "0".charCodeAt(0); for (vv = 0; vv <= 9; ++vv) BI_RC[rr++] = vv;
rr = "a".charCodeAt(0); for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;
rr = "A".charCodeAt(0); for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;

function int2char(n) { return BI_RM.charAt(n); }
function intAt(s, i) { var c = BI_RC[s.charCodeAt(i)]; return (c == null) ? -1 : c; }

function bnpCopyTo(r) { for (var i = this.t - 1; i >= 0; --i) r[i] = this[i]; r.t = this.t; r.s = this.s; }
function bnpFromInt(x) { this.t = 1; this.s = (x < 0) ? -1 : 0; if (x > 0) this[0] = x; else if (x < -1) this[0] = x + this.DV; else this.t = 0; }
function nbv(i) { var r = nbi(); r.fromInt(i); return r; }

function bnpFromString(s, b) {
  var k;
  if (b == 16) k = 4; else if (b == 8) k = 3; else if (b == 256) k = 8;
  else if (b == 2) k = 1; else if (b == 32) k = 5; else if (b == 4) k = 2;
  else { this.fromRadix(s, b); return; }
  this.t = 0; this.s = 0;
  var i = s.length, mi = false, sh = 0;
  while (--i >= 0) {
    var x = (k == 8) ? s[i] & 0xff : intAt(s, i);
    if (x < 0) { if (s.charAt(i) == "-") mi = true; continue; }
    mi = false;
    if (sh === 0) this[this.t++] = x;
    else if (sh + k > this.DB) { this[this.t - 1] |= (x & ((1 << (this.DB - sh)) - 1)) << sh; this[this.t++] = (x >> (this.DB - sh)); }
    else this[this.t - 1] |= x << sh;
    sh += k; if (sh >= this.DB) sh -= this.DB;
  }
  if (k == 8 && (s[0] & 0x80) !== 0) { this.s = -1; if (sh > 0) this[this.t - 1] |= ((1 << (this.DB - sh)) - 1) << sh; }
  this.clamp();
  if (mi) BigInteger.ZERO.subTo(this, this);
}

function bnpClamp() { var c = this.s & this.DM; while (this.t > 0 && this[this.t - 1] == c) --this.t; }

function bnToString(b) {
  if (this.s < 0) return "-" + this.negate().toString(b);
  var k;
  if (b == 16) k = 4; else if (b == 8) k = 3; else if (b == 2) k = 1;
  else if (b == 32) k = 5; else if (b == 4) k = 2; else return this.toRadix(b);
  var km = (1 << k) - 1, d, m = false, r = "", i = this.t;
  var p = this.DB - (i * this.DB) % k;
  if (i-- > 0) {
    if (p < this.DB && (d = this[i] >> p) > 0) { m = true; r = int2char(d); }
    while (i >= 0) {
      if (p < k) { d = (this[i] & ((1 << p) - 1)) << (k - p); d |= this[--i] >> (p += this.DB - k); }
      else { d = (this[i] >> (p -= k)) & km; if (p <= 0) { p += this.DB; --i; } }
      if (d > 0) m = true;
      if (m) r += int2char(d);
    }
  }
  return m ? r : "0";
}

function bnNegate() { var r = nbi(); BigInteger.ZERO.subTo(this, r); return r; }
function bnAbs() { return (this.s < 0) ? this.negate() : this; }
function bnCompareTo(a) {
  var r = this.s - a.s; if (r != 0) return r;
  var i = this.t; r = i - a.t; if (r != 0) return (this.s < 0) ? -r : r;
  while (--i >= 0) if ((r = this[i] - a[i]) != 0) return r; return 0;
}
function nbits(x) { var r = 1, t; if ((t = x >>> 16) != 0) { x = t; r += 16; } if ((t = x >> 8) != 0) { x = t; r += 8; } if ((t = x >> 4) != 0) { x = t; r += 4; } if ((t = x >> 2) != 0) { x = t; r += 2; } if ((t = x >> 1) != 0) { x = t; r += 1; } return r; }
function bnBitLength() { if (this.t <= 0) return 0; return this.DB * (this.t - 1) + nbits(this[this.t - 1] ^ (this.s & this.DM)); }
function bnpDLShiftTo(n, r) { var i; for (i = this.t - 1; i >= 0; --i) r[i + n] = this[i]; for (i = n - 1; i >= 0; --i) r[i] = 0; r.t = this.t + n; r.s = this.s; }
function bnpDRShiftTo(n, r) { for (var i = n; i < this.t; ++i) r[i - n] = this[i]; r.t = Math.max(this.t - n, 0); r.s = this.s; }
function bnpLShiftTo(n, r) { var bs = n % this.DB, cbs = this.DB - bs, bm = (1 << cbs) - 1, ds = Math.floor(n / this.DB), c = (this.s << bs) & this.DM, i; for (i = this.t - 1; i >= 0; --i) { r[i + ds + 1] = (this[i] >> cbs) | c; c = (this[i] & bm) << bs; } for (i = ds - 1; i >= 0; --i) r[i] = 0; r[ds] = c; r.t = this.t + ds + 1; r.s = this.s; r.clamp(); }
function bnpRShiftTo(n, r) { r.s = this.s; var ds = Math.floor(n / this.DB); if (ds >= this.t) { r.t = 0; return; } var bs = n % this.DB, cbs = this.DB - bs, bm = (1 << bs) - 1; r[0] = this[ds] >> bs; for (var i = ds + 1; i < this.t; ++i) { r[i - ds - 1] |= (this[i] & bm) << cbs; r[i - ds] = this[i] >> bs; } if (bs > 0) r[this.t - ds - 1] |= (this.s & bm) << cbs; r.t = this.t - ds; r.clamp(); }

function bnpSubTo(a, r) {
  var i = 0, c = 0, m = Math.min(a.t, this.t);
  while (i < m) { c += this[i] - a[i]; r[i++] = c & this.DM; c >>= this.DB; }
  if (a.t < this.t) { c -= a.s; while (i < this.t) { c += this[i]; r[i++] = c & this.DM; c >>= this.DB; } c += this.s; }
  else { c += this.s; while (i < a.t) { c -= a[i]; r[i++] = c & this.DM; c >>= this.DB; } c -= a.s; }
  r.s = (c < 0) ? -1 : 0;
  if (c < -1) r[i++] = this.DV + c; else if (c > 0) r[i++] = c;
  r.t = i; r.clamp();
}

function bnpMultiplyTo(a, r) { var x = this.abs(), y = a.abs(); var i = x.t; r.t = i + y.t; while (--i >= 0) r[i] = 0; for (i = 0; i < y.t; ++i) r[i + x.t] = x.am(0, y[i], r, i, 0, x.t); r.s = 0; r.clamp(); if (this.s != a.s) BigInteger.ZERO.subTo(r, r); }
function bnpSquareTo(r) { var x = this.abs(); var i = r.t = 2 * x.t; while (--i >= 0) r[i] = 0; for (i = 0; i < x.t - 1; ++i) { var c = x.am(i, x[i], r, 2 * i, 0, 1); if ((r[i + x.t] += x.am(i + 1, 2 * x[i], r, 2 * i + 1, c, x.t - i - 1)) >= x.DV) { r[i + x.t] -= x.DV; r[i + x.t + 1] = 1; } } if (r.t > 0) r[r.t - 1] += x.am(i, x[i], r, 2 * i, 0, 1); r.s = 0; r.clamp(); }

function bnpDivRemTo(m, q, r) {
  var pm = m.abs(); if (pm.t <= 0) return;
  var pt = this.abs(); if (pt.t < pm.t) { if (q != null) q.fromInt(0); if (r != null) this.copyTo(r); return; }
  if (r == null) r = nbi();
  var y = nbi(), ts = this.s, ms = m.s;
  var nsh = this.DB - nbits(pm[pm.t - 1]);
  if (nsh > 0) { pm.lShiftTo(nsh, y); pt.lShiftTo(nsh, r); } else { pm.copyTo(y); pt.copyTo(r); }
  var ys = y.t, y0 = y[ys - 1]; if (y0 == 0) return;
  var yt = y0 * (1 << this.F1) + ((ys > 1) ? y[ys - 2] >> this.F2 : 0);
  var d1 = this.FV / yt, d2 = (1 << this.F1) / yt, e = 1 << this.F2;
  var i = r.t, j = i - ys, t = (q == null) ? nbi() : q;
  y.dlShiftTo(j, t);
  if (r.compareTo(t) >= 0) { r[r.t++] = 1; r.subTo(t, r); }
  BigInteger.ONE.dlShiftTo(ys, t); t.subTo(y, y);
  while (y.t < ys) y[y.t++] = 0;
  while (--j >= 0) {
    var qd = (r[--i] == y0) ? this.DM : Math.floor(r[i] * d1 + (r[i - 1] + e) * d2);
    if ((r[i] += y.am(0, qd, r, j, 0, ys)) < qd) { y.dlShiftTo(j, t); r.subTo(t, r); while (r[i] < --qd) r.subTo(t, r); }
  }
  if (q != null) { r.drShiftTo(ys, q); if (ts != ms) BigInteger.ZERO.subTo(q, q); }
  r.t = ys; r.clamp();
  if (nsh > 0) r.rShiftTo(nsh, r);
  if (ts < 0) BigInteger.ZERO.subTo(r, r);
}

function bnMod(a) { var r = nbi(); this.abs().divRemTo(a, null, r); if (this.s < 0 && r.compareTo(BigInteger.ZERO) > 0) a.subTo(r, r); return r; }

function Classic(m) { this.m = m; }
function cConvert(x) { if (x.s < 0 || x.compareTo(this.m) >= 0) return x.mod(this.m); else return x; }
function cRevert(x) { return x; }
function cReduce(x) { x.divRemTo(this.m, null, x); }
function cMulTo(x, y, r) { x.multiplyTo(y, r); this.reduce(r); }
function cSqrTo(x, r) { x.squareTo(r); this.reduce(r); }
Classic.prototype.convert = cConvert; Classic.prototype.revert = cRevert; Classic.prototype.reduce = cReduce; Classic.prototype.mulTo = cMulTo; Classic.prototype.sqrTo = cSqrTo;

function bnpInvDigit() { if (this.t < 1) return 0; var x = this[0]; if ((x & 1) == 0) return 0; var y = x & 3; y = (y * (2 - (x & 0xf) * y)) & 0xf; y = (y * (2 - (x & 0xff) * y)) & 0xff; y = (y * (2 - (((x & 0xffff) * y) & 0xffff))) & 0xffff; y = (y * (2 - x * y % this.DV)) % this.DV; return (y > 0) ? this.DV - y : -y; }

function Montgomery(m) { this.m = m; this.mp = m.invDigit(); this.mpl = this.mp & 0x7fff; this.mph = this.mp >> 15; this.um = (1 << (m.DB - 15)) - 1; this.mt2 = 2 * m.t; }
function montConvert(x) { var r = nbi(); x.abs().dlShiftTo(this.m.t, r); r.divRemTo(this.m, null, r); if (x.s < 0 && r.compareTo(BigInteger.ZERO) > 0) this.m.subTo(r, r); return r; }
function montRevert(x) { var r = nbi(); x.copyTo(r); this.reduce(r); return r; }
function montReduce(x) { while (x.t <= this.mt2) x[x.t++] = 0; for (var i = 0; i < this.m.t; ++i) { var j = x[i] & 0x7fff; var u0 = (j * this.mpl + (((j * this.mph + (x[i] >> 15) * this.mpl) & this.um) << 15)) & x.DM; j = i + this.m.t; x[j] += this.m.am(0, u0, x, i, 0, this.m.t); while (x[j] >= x.DV) { x[j] -= x.DV; x[++j]++; } } x.clamp(); x.drShiftTo(this.m.t, x); if (x.compareTo(this.m) >= 0) x.subTo(this.m, x); }
function montSqrTo(x, r) { x.squareTo(r); this.reduce(r); }
function montMulTo(x, y, r) { x.multiplyTo(y, r); this.reduce(r); }
Montgomery.prototype.convert = montConvert; Montgomery.prototype.revert = montRevert; Montgomery.prototype.reduce = montReduce; Montgomery.prototype.mulTo = montMulTo; Montgomery.prototype.sqrTo = montSqrTo;

function bnpIsEven() { return ((this.t > 0) ? (this[0] & 1) : this.s) == 0; }
function bnpExp(e, z) { if (e > 0xffffffff || e < 1) return BigInteger.ONE; var r = nbi(), r2 = nbi(), g = z.convert(this), i = nbits(e) - 1; g.copyTo(r); while (--i >= 0) { z.sqrTo(r, r2); if ((e & (1 << i)) > 0) z.mulTo(r2, g, r); else { var t = r; r = r2; r2 = t; } } return z.revert(r); }
function bnModPowInt(e, m) { var z; if (e < 256 || m.isEven()) z = new Classic(m); else z = new Montgomery(m); return this.exp(e, z); }

BigInteger.prototype.copyTo = bnpCopyTo; BigInteger.prototype.fromInt = bnpFromInt; BigInteger.prototype.fromString = bnpFromString;
BigInteger.prototype.clamp = bnpClamp; BigInteger.prototype.dlShiftTo = bnpDLShiftTo; BigInteger.prototype.drShiftTo = bnpDRShiftTo;
BigInteger.prototype.lShiftTo = bnpLShiftTo; BigInteger.prototype.rShiftTo = bnpRShiftTo; BigInteger.prototype.subTo = bnpSubTo;
BigInteger.prototype.multiplyTo = bnpMultiplyTo; BigInteger.prototype.squareTo = bnpSquareTo; BigInteger.prototype.divRemTo = bnpDivRemTo;
BigInteger.prototype.invDigit = bnpInvDigit; BigInteger.prototype.isEven = bnpIsEven; BigInteger.prototype.exp = bnpExp;
BigInteger.prototype.toString = bnToString; BigInteger.prototype.negate = bnNegate; BigInteger.prototype.abs = bnAbs;
BigInteger.prototype.compareTo = bnCompareTo; BigInteger.prototype.bitLength = bnBitLength; BigInteger.prototype.mod = bnMod;
BigInteger.prototype.modPowInt = bnModPowInt;
BigInteger.ZERO = nbv(0); BigInteger.ONE = nbv(1);

function SecureRandom() {}
SecureRandom.prototype.nextBytes = function(ba) {
  const crypto = require("crypto");
  const buf = crypto.randomBytes(ba.length);
  for (let i = 0; i < ba.length; i++) ba[i] = buf[i];
};

function parseBigInt(str, r) { return new BigInteger(str, r); }

function pkcs1pad2(s, n) {
  if (n < s.length + 11) return null;
  var ba = [], i = s.length - 1;
  while (i >= 0 && n > 0) {
    var c = s.charCodeAt(i--);
    if (c < 128) { ba[--n] = c; }
    else if ((c > 127) && (c < 2048)) { ba[--n] = (c & 63) | 128; ba[--n] = (c >> 6) | 192; }
    else { ba[--n] = (c & 63) | 128; ba[--n] = ((c >> 6) & 63) | 128; ba[--n] = (c >> 12) | 224; }
  }
  ba[--n] = 0;
  var rng = new SecureRandom(), x = [];
  while (n > 2) { x[0] = 0; while (x[0] == 0) rng.nextBytes(x); ba[--n] = x[0]; }
  ba[--n] = 2; ba[--n] = 0;
  return new BigInteger(ba);
}

function RSAKey() { this.n = null; this.e = 0; }
RSAKey.prototype.setPublic = function(N, E) { this.n = parseBigInt(N, 16); this.e = parseInt(E, 16); };
RSAKey.prototype.doPublic = function(x) { return x.modPowInt(this.e, this.n); };
RSAKey.prototype.encrypt = function(text) {
  var m = pkcs1pad2(text, (this.n.bitLength() + 7) >> 3);
  if (m == null) return null;
  var c = this.doPublic(m);
  if (c == null) return null;
  var h = c.toString(16);
  return ((h.length & 1) == 0) ? h : "0" + h;
};

function rsaNewPubKey(n, e) {
  var k = new RSAKey();
  e = e || "10001";
  k.setPublic(n, e);
  k.keyLength = n.length;
  return k;
}

function rsaEncryptSegment(text, pub_key) {
  if (!(pub_key instanceof RSAKey)) pub_key = rsaNewPubKey(pub_key);
  var cipher = pub_key.encrypt(text);
  var i = 1, pad = "0", pad_l = pub_key.keyLength - cipher.length;
  while (i < pad_l) { pad += pad; i += i; }
  return pad.slice(0, pad_l) + cipher;
}

function vivotekEncrypt(username, password, publicKeyObj) {
  var pad = Math.ceil(Math.random() * Math.pow(2, 32)).toString(16);
  var text = `:${username}:${password}`;
  var encode_l, seg_l;
  var keyLen = (publicKeyObj && publicKeyObj.n) ? publicKeyObj.n.length : 0;
  switch (keyLen) {
    case 256: seg_l = 117; encode_l = 234; break;
    case 128: seg_l = 53;  encode_l = 159; break;
    default:
      return `${pad}f00000000${pad}ba222222222${pad}`;
  }
  var pad_l = encode_l - text.length;
  for (var l = pad.length; l < pad_l; l += l) pad += pad;
  text = pad.slice(0, pad_l) + text;
  var pub_key = rsaNewPubKey(publicKeyObj.n.toLowerCase());
  var encode = "";
  for (l = 0; l < encode_l; l += seg_l) {
    encode += rsaEncryptSegment(text.slice(l, l + seg_l), pub_key);
  }
  return encode;
}

// ══════════════════════════════════════════════════════════
// MAPA DE IPs
// ══════════════════════════════════════════════════════════

const IP_JSON_PATH = path.join(__dirname, "ip.json");
let IP_BUSES = {};

if (fs.existsSync(IP_JSON_PATH)) {
  try {
    const raw = JSON.parse(fs.readFileSync(IP_JSON_PATH, "utf8"));
    IP_BUSES = raw.ip_buses || raw;
    console.log(`  ✓ ip.json cargado (${Object.keys(IP_BUSES).length} buses registrados)`);
  } catch (e) {
    console.warn(`  ⚠ No se pudo leer ip.json: ${e.message}`);
  }
} else {
  console.warn(`  ⚠ ip.json no encontrado — se usará nvr_ip del jobs.json`);
}

function resolveIp(bus_id) {
  if (!bus_id) return null;
  if (IP_BUSES[bus_id]) return IP_BUSES[bus_id];
  const sinPrefijo = bus_id.replace(/^\d+\.\s*/, "").trim();
  if (sinPrefijo !== bus_id && IP_BUSES[sinPrefijo]) return IP_BUSES[sinPrefijo];
  return null;
}

// ══════════════════════════════════════════════════════════
// TIEMPO Y NOMBRES
// ══════════════════════════════════════════════════════════

const UTC_OFFSET_HOURS = 5;

function toMicroseconds(fecha, hora) {
  const isoStr  = `${fecha}T${hora}Z`;
  const localMs = new Date(isoStr).getTime();
  if (isNaN(localMs)) throw new Error(`Fecha/hora inválida: "${fecha} ${hora}"`);
  return BigInt(localMs + UTC_OFFSET_HOURS * 3600 * 1000) * 1000n;
}

const minToUs = (m) => BigInt(m) * 60n * 1_000_000n;

function buildFilename(nvr_ip, channel, fecha, hora) {
  const MAC_MAP = { "172.23.10.240": "F002D19BF1DF" };
  const mac = MAC_MAP[nvr_ip] || "F002D19BF1DF";
  return `${mac}_${fecha.replace(/-/g, "")}_${hora.replace(/:/g, "")}_${channel + 1}`;
}

function buildOutputDir(bus_id, fecha, descripcion) {
  return path.join("descargas", `${bus_id}_${fecha.replace(/-/g, "")}_${descripcion}`);
}

// ══════════════════════════════════════════════════════════
// HTTP HELPERS
// ══════════════════════════════════════════════════════════

function buildCookies(sid) {
  return `mode=playback; language=0; savedUserName=; _SID_=${sid}`;
}

function httpReq(nvr_ip, method, urlPath, extraHeaders, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body, "utf8") : null;
    const headers = {
      "Accept":          "text/plain, */*; q=0.01",
      "Accept-Encoding": "identity",
      "Accept-Language": "es-419,es;q=0.9",
      "Connection":      "keep-alive",
      "Referer":         `http://${nvr_ip}/classic/index.html`,
      "Content-Type":    "application/x-www-form-urlencoded; charset=UTF-8",
      ...(data ? { "Content-Length": String(data.length) } : {}),
      ...extraHeaders,
    };
    const r = http.request(
      { hostname: nvr_ip, port: 80, method, path: urlPath, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end",  () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function downloadBinary(nvr_ip, urlPath, cookieStr, destPath) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: nvr_ip, port: 80, method: "GET", path: urlPath,
        headers: {
          "Accept": "*/*", "Accept-Encoding": "identity",
          "Connection": "keep-alive",
          "Referer": `http://${nvr_ip}/classic/index.html`,
          "Cookie": cookieStr,
        },
      },
      (res) => {
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode} al descargar`));
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        const ws = fs.createWriteStream(destPath);
        res.on("data", (chunk) => {
          received += chunk.length;
          ws.write(chunk);
          const kb = (received / 1024).toFixed(0);
          if (total > 0) {
            process.stdout.write(`\r      ↓ ${((received / total) * 100).toFixed(1).padStart(5)}%  (${kb} / ${(total / 1024).toFixed(0)} KB)   `);
          } else {
            process.stdout.write(`\r      ↓ ${kb} KB…`);
          }
        });
        res.on("end",   () => { ws.end(); process.stdout.write("\n"); resolve(destPath); });
        res.on("error", (e) => { ws.destroy(); reject(e); });
        ws.on("error",  reject);
      }
    );
    r.on("error", reject);
    r.end();
  });
}

// ══════════════════════════════════════════════════════════
// LOGIN RSA
// ══════════════════════════════════════════════════════════

async function fetchPublicKey(nvr_ip) {
  const res = await httpReq(nvr_ip, "GET", `/fcgi-bin/system.key?${Date.now()}`, {}, null);
  if (res.status !== 200) throw new Error(`Error obteniendo clave pública (HTTP ${res.status})`);
  let keyObj;
  try { keyObj = JSON.parse(res.body); }
  catch {
    const n = res.body.trim().replace(/[^0-9a-fA-F]/g, "");
    if (!n) throw new Error(`Clave pública inválida: ${res.body.slice(0, 100)}`);
    keyObj = { n };
  }
  if (!keyObj.n) throw new Error(`Clave pública sin campo 'n': ${res.body.slice(0, 200)}`);
  return keyObj;
}

async function nvrLogin(nvr_ip, nvr_user, nvr_pass) {
  const publicKeyObj = await fetchPublicKey(nvr_ip);
  const cipherText   = vivotekEncrypt(nvr_user, nvr_pass, publicKeyObj);
  const body         = `encode=${cipherText}`;
  const res          = await httpReq(
    nvr_ip, "POST", "/fcgi-bin/system.login",
    {
      "Authorization":  `Basic ${cipherText}`,
      "Content-Length": String(Buffer.byteLength(body, "utf8")),
      "Origin":         `http://${nvr_ip}`,
      "Referer":        `http://${nvr_ip}/liveview.html`,
    },
    body
  );
  if (res.status === 401) throw new Error(`Login fallido (401) en ${nvr_ip} — verifica nvr_user y nvr_pass.`);
  if (res.status !== 200) throw new Error(`Login HTTP ${res.status} en ${nvr_ip}: ${res.body.slice(0, 120)}`);

  const cookies = Array.isArray(res.headers["set-cookie"])
    ? res.headers["set-cookie"] : [res.headers["set-cookie"] || ""];
  for (const c of cookies) {
    const m = c.match(/_SID_=([^;]+)/);
    if (m) return m[1].trim();
  }
  try {
    const json = JSON.parse(res.body);
    if (json._SID_) return json._SID_;
    if (json.sessionId) return json.sessionId;
  } catch { /* no era JSON */ }

  throw new Error(`Login OK pero sin _SID_.\n  Headers: ${JSON.stringify(res.headers)}\n  Body: ${res.body.slice(0, 200)}`);
}

// ══════════════════════════════════════════════════════════
// LÓGICA NVR
// ══════════════════════════════════════════════════════════

async function exportCreate(nvr_ip, cookieStr, channel, fecha, hora, duracion_minutos, formato) {
  const startUs  = toMicroseconds(fecha, hora);
  const lengthUs = minToUs(duracion_minutos);
  const filename = buildFilename(nvr_ip, channel, fecha, hora);

  const body = [
    `channel=${channel}`,
    `start_time=${startUs}`,
    `length=${lengthUs}`,
    `format=${formato}`,
    `with_log=true`,
    `with_info=false`,
    `recording_type=main_stream`,
    `filename=${encodeURIComponent(filename)}`,
  ].join("&");

  const res = await httpReq(nvr_ip, "POST", "/fcgi-bin/operator/database.export_create", { "Cookie": cookieStr }, body);
  if (res.status === 401) throw new Error("401 – SID expirado o inválido.");
  if (res.status !== 200) throw new Error(`HTTP ${res.status} en export_create: ${res.body.slice(0, 100)}`);

  const m = res.body.match(/<ticket>([^<]+)<\/ticket>/i)
         || res.body.match(/ticket[>\s='"]+([^\s<"'&]+)/i)
         || res.body.match(/(\/com\/vivotek\/TaskManager\/tasks\/[^\s<"'&]+)/i);
  if (!m) throw new Error("No se encontró ticket en: " + res.body.slice(0, 200));
  return { ticket: (m[1] || m[0]).trim(), filename };
}

async function pollStatus(nvr_ip, cookieStr, ticket, timeoutMs = 180_000) {
  const body = `ticket=${encodeURIComponent(ticket)}`;
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < timeoutMs) {
    n++;
    await new Promise((r) => setTimeout(r, 2500));
    const res = await httpReq(nvr_ip, "POST", "/fcgi-bin/operator/database.export_status", { "Cookie": cookieStr }, body);
    if (res.status === 401) throw new Error("401 – SID expirado durante polling.");
    const text = res.body;
    const prog = (text.match(/<progress>(\d+)<\/progress>/i) || text.match(/progress[>\s='"]+(\d+)/i) || [])[1] || "?";
    const stat = (text.match(/<status>([^<]+)<\/status>/i)   || text.match(/status[>\s='"]+([^\s<"']+)/i) || [])[1] || text.slice(0, 40).replace(/\n/g, " ");
    process.stdout.write(`\r      Poll #${String(n).padStart(2)} | ${String(prog).padStart(3)}% | ${stat}          `);
    if (/done|complete|finish/i.test(text) || prog === "100") { process.stdout.write("\n      ✓ Listo.\n"); return; }
    if (/\berror\b|\bfail\b/i.test(stat)) { process.stdout.write("\n"); throw new Error("NVR reportó error: " + text.slice(0, 200)); }
  }
  throw new Error("Timeout: exportación tardó más de 3 minutos.");
}

async function downloadExport(nvr_ip, cookieStr, ticket, filename, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const destPath = path.join(outputDir, `${filename}.tar`);
  await downloadBinary(nvr_ip, `/fcgi-bin/operator/database.export_fetch?ticket=${encodeURIComponent(ticket)}`, cookieStr, destPath);
  return destPath;
}

// ══════════════════════════════════════════════════════════
// PROCESAR BUS
// ══════════════════════════════════════════════════════════

async function processBus(busJob, busIdx, totalBuses) {
  let {
    descripcion = "", bus_id = "", tipo_bus,
    nvr_ip, nvr_user, nvr_pass, nvr_sid,
    fecha, hora_inicio, duracion_minutos,
    formato = "3gp", camaras,
  } = busJob;

  // 1. Resolver IP
  if (!nvr_ip && bus_id) {
    const ip = resolveIp(bus_id);
    if (ip) nvr_ip = ip;
    else throw new Error(`No se encontró IP para "${bus_id}" en ip.json.`);
  }
  if (!nvr_ip) throw new Error(`Job ${busIdx + 1}: falta "nvr_ip" o "bus_id".`);

  // 2. Validar campos obligatorios
  const faltantes = ["fecha", "hora_inicio", "duracion_minutos", "camaras"]
    .filter(k => busJob[k] === undefined || busJob[k] === null || busJob[k] === "");
  if (faltantes.length) throw new Error(`Faltan campos: ${faltantes.join(", ")}`);
  if (!nvr_user && !nvr_pass && !nvr_sid)
    throw new Error(`Job ${busIdx + 1}: falta autenticación (nvr_user+nvr_pass o nvr_sid).`);

  // 3. Resolver canales desde tipo_bus + camaras
  const canales = resolveCanales(camaras, tipo_bus);

  // Descripción del tipo de bus para logs
  const tipoBusStr = tipo_bus ? tipo_bus.toUpperCase() : "GENERICO";

  // 4. Login RSA
  let sid = nvr_sid || null;
  if (nvr_user && nvr_pass) {
    process.stdout.write(`\n  🔐 Login RSA en ${nvr_ip} (${bus_id}) … `);
    try {
      sid = await nvrLogin(nvr_ip, nvr_user, nvr_pass);
      console.log(`✓  SID: ${sid.slice(0, 8)}…`);
    } catch (loginErr) {
      if (nvr_sid) {
        console.warn(`\n  ⚠ Login falló: ${loginErr.message}`);
        console.warn(`  ⚠ Usando nvr_sid manual como fallback.`);
        sid = nvr_sid;
      } else {
        throw loginErr;
      }
    }
  } else {
    console.log(`\n  ℹ Usando nvr_sid manual para ${bus_id}.`);
  }

  const cookieStr = buildCookies(sid);
  const outputDir = buildOutputDir(bus_id || nvr_ip, fecha, descripcion);
  const resultados = [];

  // 5. Cabecera
  const camarasStr = Array.isArray(camaras)
    ? camaras.join(", ")
    : camaras;

  console.log(`\n${"╔" + "═".repeat(58) + "╗"}`);
  console.log(`║  BUS ${busIdx + 1}/${totalBuses}: ${descripcion.padEnd(50)}║`);
  console.log(`║  ID: ${(bus_id || nvr_ip).padEnd(14)}  Tipo: ${tipoBusStr.padEnd(10)}  NVR: ${nvr_ip.padEnd(13)}║`);
  console.log(`║  Fecha: ${fecha}  Hora: ${hora_inicio}  Duración: ${String(duracion_minutos).padEnd(3)} min  `.padEnd(59) + "║");
  console.log(`║  Cámaras: ${camarasStr.padEnd(47)}║`);
  console.log(`║  Canales: ${canales.join(", ").padEnd(47)}║`);
  console.log(`║  Carpeta: ${outputDir.padEnd(47)}║`);
  console.log(`${"╚" + "═".repeat(58) + "╝"}`);

  // 6. Descargar cada canal (con soporte de duraciones > 10 min en chunks)
  const MAX_MIN_POR_CHUNK = 10; // límite del NVR por exportación

  for (const channel of canales) {
    const label = `Canal ${channel} – ${getCameraLabel(channel, tipo_bus)}`;
    console.log(`\n  ── ${label} ${"─".repeat(Math.max(0, 48 - label.length))}`);

    // Calcular chunks de tiempo necesarios
    const totalChunks  = Math.ceil(duracion_minutos / MAX_MIN_POR_CHUNK);
    const savedFiles   = [];
    let   chunkError   = null;

    for (let chunk = 0; chunk < totalChunks; chunk++) {
      const chunkMin    = Math.min(MAX_MIN_POR_CHUNK, duracion_minutos - chunk * MAX_MIN_POR_CHUNK);
      const chunkOffset = chunk * MAX_MIN_POR_CHUNK * 60; // segundos de offset

      // Calcular hora de inicio del chunk
      const [hh, mm, ss] = hora_inicio.split(":").map(Number);
      const totalSecs     = hh * 3600 + mm * 60 + ss + chunkOffset;
      const chunkHH       = String(Math.floor(totalSecs / 3600) % 24).padStart(2, "0");
      const chunkMM       = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, "0");
      const chunkSS       = String(totalSecs % 60).padStart(2, "0");
      const chunkHora     = `${chunkHH}:${chunkMM}:${chunkSS}`;

      const chunkLabel = totalChunks > 1
        ? `[${chunk + 1}/${totalChunks}] ${chunkHora} (${chunkMin} min)`
        : `${chunkHora} (${chunkMin} min)`;

      try {
        process.stdout.write(`      Exportación ${chunkLabel} … `);
        const { ticket, filename } = await exportCreate(nvr_ip, cookieStr, channel, fecha, chunkHora, chunkMin, formato);
        console.log(`ticket: ${ticket}`);
        process.stdout.write("      Procesando … ");
        await pollStatus(nvr_ip, cookieStr, ticket);
        process.stdout.write("      Descargando … \n");
        const saved = await downloadExport(nvr_ip, cookieStr, ticket, filename, outputDir);
        console.log(`      ✓ ${path.resolve(saved)}`);
        savedFiles.push(saved);
        writeLog({
          bus_id: bus_id, tipo_bus: tipo_bus, descripcion,
          nvr_ip, fecha_video: fecha, hora_video: chunkHora,
          duracion_min: chunkMin, canal: channel, camara_label: getCameraLabel(channel, tipo_bus),
          chunk: chunk + 1, total_chunks: totalChunks,
          estado: "OK", archivo: path.resolve(saved), error: ""
        });
      } catch (err) {
        console.error(`\n      ✗ Error en chunk ${chunk + 1}: ${err.message}`);
        chunkError = err.message;
        writeLog({
          bus_id, tipo_bus, descripcion, nvr_ip,
          fecha_video: fecha, hora_video: chunkHora,
          duracion_min: chunkMin, canal: channel, camara_label: getCameraLabel(channel, tipo_bus),
          chunk: chunk + 1, total_chunks: totalChunks,
          estado: "ERROR", archivo: "", error: err.message
        });
        // no break → continúa con los chunks siguientes
      }
    }

    if (chunkError && savedFiles.length === 0) {
      resultados.push({ channel, label, ok: false, error: chunkError });
    } else {
      resultados.push({ channel, label, ok: true, files: savedFiles, chunks: totalChunks });
      if (chunkError) {
        console.warn(`      ⚠ Descarga parcial: ${savedFiles.length}/${totalChunks} chunks completados.`);
      }
    }
  }

  return { descripcion, bus_id, tipo_bus, nvr_ip, fecha, hora_inicio, outputDir, resultados };
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

async function main() {
  const jobsFile = process.argv[2] || "jobs.json";
  initLog(); // inicializar archivo de logs si no existe
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   Vivotek NV9411P-A – Descargador Multi-Bus             ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  Leyendo: ${jobsFile}\n`);

  if (!fs.existsSync(jobsFile)) {
    console.error(`✗ No se encontró "${jobsFile}".`); process.exit(1);
  }

  let jobs;
  try {
    jobs = loadJobs(jobsFile);
    console.log(`  ✓ ${jobs.length} job(s) cargados desde ${path.extname(jobsFile).toUpperCase()}\n`);
  } catch (e) {
    console.error(`✗ Error leyendo ${jobsFile}: ${e.message}`); process.exit(1);
  }

  const todosResultados = [];
  for (let i = 0; i < jobs.length; i++) {
    try {
      todosResultados.push(await processBus(jobs[i], i, jobs.length));
    } catch (err) {
      console.error(`\n✗ Error fatal en bus ${i + 1}: ${err.message}`);
      writeLog({
        bus_id: jobs[i].bus_id || "", tipo_bus: jobs[i].tipo_bus || "",
        descripcion: jobs[i].descripcion || `Bus ${i + 1}`,
        nvr_ip: jobs[i].nvr_ip || "", fecha_video: jobs[i].fecha || "",
        hora_video: jobs[i].hora_inicio || "", duracion_min: jobs[i].duracion_minutos || "",
        canal: "", camara_label: "", chunk: "", total_chunks: "",
        estado: "ERROR_FATAL", archivo: "", error: err.message
      });
      todosResultados.push({ descripcion: jobs[i].descripcion || `Bus ${i + 1}`, error: err.message });
    }
  }

  console.log("\n\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  RESUMEN FINAL                                           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  let totalOk = 0, totalFail = 0;
  for (const bus of todosResultados) {
    const titulo = [bus.bus_id, bus.tipo_bus, bus.descripcion].filter(Boolean).join(" – ");
    console.log(`\n  📹 ${titulo || bus.nvr_ip}  (${bus.nvr_ip || ""})  ${bus.fecha || ""} ${bus.hora_inicio || ""}`);
    if (bus.outputDir) console.log(`     📁 ${path.resolve(bus.outputDir)}`);
    if (bus.error) { console.log(`     ✗ Fallo general: ${bus.error}`); totalFail++; continue; }
    for (const r of bus.resultados || []) {
      if (r.ok) {
        const filesStr = r.files ? r.files.map(f => path.basename(f)).join(", ") : r.file;
        const chunksStr = r.chunks > 1 ? ` (${r.chunks} chunks)` : "";
        console.log(`     ✓ ${r.label}${chunksStr} → ${filesStr}`);
        totalOk++;
      }
      else       { console.log(`     ✗ ${r.label} → FALLO: ${r.error}`); totalFail++; }
    }
  }
  console.log(`\n  Total: ${totalOk} OK  |  ${totalFail} fallidos`);
  console.log(`  📋 Log guardado en: ${path.resolve(LOG_FILE)}\n`);
}

main();
