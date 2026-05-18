#!/usr/bin/env node
/**
 * NVR Downloader — Servidor local
 * node server.js  →  http://localhost:3000
 * Sin dependencias externas.
 */

const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const { spawn } = require("child_process");

const PORT      = 3000;
const JOBS_FILE = path.join(__dirname, "jobs.json");
const DL_SCRIPT = path.join(__dirname, "vivotek-download.js");

let sseClients      = [];
let downloadProcess = null;
let downloadRunning = false;

function sseNotify(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(r => { try { r.write(msg); } catch(_){} });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML); return;
  }
  if (req.method === "GET" && url.pathname === "/jobs") {
    try {
      const d = fs.existsSync(JOBS_FILE) ? fs.readFileSync(JOBS_FILE,"utf8") : "[]";
      res.writeHead(200,{"Content-Type":"application/json"}); res.end(d);
    } catch(e){ res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/jobs") {
    let body="";
    req.on("data",c=>body+=c);
    req.on("end",()=>{
      try {
        JSON.parse(body);
        fs.writeFileSync(JOBS_FILE,body,"utf8");
        res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true}));
      } catch(e){ res.writeHead(400); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }
  if (req.method === "POST" && url.pathname === "/start") {
    if (downloadRunning) {
      res.writeHead(409,{"Content-Type":"application/json"});
      res.end(JSON.stringify({error:"Ya hay una descarga en curso."})); return;
    }
    res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true}));
    downloadRunning = true;
    sseNotify({type:"start",ts:new Date().toISOString()});
    downloadProcess = spawn(process.execPath,[DL_SCRIPT],{cwd:__dirname,env:process.env});
    downloadProcess.stdout.on("data",chunk=>{
      chunk.toString().split(/\r?\n/).filter(l=>l.trim()).forEach(line=>sseNotify({type:"log",line}));
    });
    downloadProcess.stderr.on("data",chunk=>{
      chunk.toString().split(/\r?\n/).filter(l=>l.trim()).forEach(line=>sseNotify({type:"err",line}));
    });
    downloadProcess.on("close",code=>{
      downloadRunning=false; downloadProcess=null;
      sseNotify({type:"done",code,ts:new Date().toISOString()});
    }); return;
  }
  if (req.method === "POST" && url.pathname === "/stop") {
    if (downloadProcess){ downloadProcess.kill("SIGTERM"); downloadRunning=false; sseNotify({type:"stopped"}); }
    res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true})); return;
  }
  if (req.method === "GET" && url.pathname === "/status") {
    res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({running:downloadRunning})); return;
  }
  if (req.method === "GET" && url.pathname === "/progress") {
    res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive"});
    res.write("retry: 1000\n\n");
    sseClients.push(res);
    req.on("close",()=>{ sseClients=sseClients.filter(c=>c!==res); }); return;
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT,"127.0.0.1",()=>{
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  NVR Downloader — http://localhost:3000  ║");
  console.log("╚══════════════════════════════════════════╝\n");
  const {exec}=require("child_process");
  exec(`start http://localhost:${PORT}`);
});

// ═══════════════════════════════════════════════════════════
// HTML
// ═══════════════════════════════════════════════════════════
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NVR Downloader</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f4f5f7;
  --white:#ffffff;
  --border:#dde1e7;
  --border2:#c8cdd6;
  --surface:#f9fafb;
  --accent:#1a6ef7;
  --accent-hover:#1459d4;
  --accent-light:#e8f0fe;
  --green:#1a7f4b;
  --green-bg:#e6f4ee;
  --red:#c0392b;
  --red-bg:#fdecea;
  --orange:#b45309;
  --orange-bg:#fef3e2;
  --text:#111827;
  --muted:#6b7280;
  --muted2:#9ca3af;
  --font:'DM Sans',sans-serif;
  --mono:'DM Mono',monospace;
  --r:6px;
  --r2:10px;
  --shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04);
  --shadow-md:0 4px 12px rgba(0,0,0,.1);
}
html,body{height:100%;font-family:var(--font);background:var(--bg);color:var(--text);font-size:13px;line-height:1.4}
body{display:flex;overflow:hidden}

/* ── Layout ── */
.sidebar{width:300px;flex-shrink:0;background:var(--white);border-right:1px solid var(--border);display:flex;flex-direction:column;height:100vh;overflow:hidden}
.sidebar-body{flex:1;overflow-y:auto;padding:12px}
.sidebar-body::-webkit-scrollbar{width:4px}
.sidebar-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;height:100vh}
.main-top{flex:1;overflow-y:auto;padding:14px}
.main-top::-webkit-scrollbar{width:4px}
.main-top::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}

/* ── Header sidebar ── */
.sidebar-header{padding:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;background:var(--white)}
.logo-icon{width:30px;height:30px;border-radius:7px;background:var(--accent);display:grid;place-items:center;font-size:15px;flex-shrink:0}
.logo-title{font-size:13px;font-weight:700;color:var(--text)}
.logo-sub{font-size:10px;color:var(--muted);font-family:var(--mono)}

/* ── Labels ── */
.lbl{font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;margin-top:10px;display:block}
.lbl:first-child{margin-top:0}

/* ── Tipo bus ── */
.tipo-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:2px}
.tipo-radio input{display:none}
.tipo-radio label{display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 8px;border-radius:var(--r);border:1.5px solid var(--border);background:var(--surface);cursor:pointer;font-size:12px;font-weight:600;transition:all .15s;color:var(--muted)}
.tipo-radio input:checked+label{border-color:var(--accent);background:var(--accent-light);color:var(--accent)}

/* ── Inputs ── */
.field{margin-bottom:6px}
.field input,.field select{width:100%;padding:7px 9px;border:1.5px solid var(--border);border-radius:var(--r);font-family:var(--mono);font-size:12px;color:var(--text);background:var(--white);outline:none;transition:border-color .15s,box-shadow .15s;-webkit-appearance:none}
.field input:focus,.field select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(26,110,247,.12)}
.field input::placeholder{color:var(--muted2)}
.field input[type=date],.field input[type=time]{cursor:pointer;color:var(--text)}
.field input[type=date]::-webkit-calendar-picker-indicator,
.field input[type=time]::-webkit-calendar-picker-indicator{cursor:pointer;opacity:.6}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}

/* ── Cámaras ── */
.cams-header{display:flex;align-items:center;justify-content:space-between;margin-top:10px;margin-bottom:4px}
.cams-actions{display:flex;gap:4px}
.cam-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-bottom:8px}
.cam-grid.padron{grid-template-columns:repeat(4,1fr)}
.cam-input{display:none}
.cam-tile{display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 4px;border-radius:var(--r);border:1.5px solid var(--border);background:var(--surface);cursor:pointer;transition:all .15s;text-align:center;user-select:none}
.cam-tile:hover{border-color:var(--border2)}
.cam-icon{font-size:14px;line-height:1}
.cam-s{font-size:10px;font-weight:700;font-family:var(--mono);color:var(--muted)}
.cam-n{font-size:9px;color:var(--muted2);font-family:var(--mono)}
.cam-input:checked+.cam-tile{border-color:var(--accent);background:var(--accent-light)}
.cam-input:checked+.cam-tile .cam-s{color:var(--accent)}

/* ── Buttons ── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:7px 14px;border-radius:var(--r);border:none;cursor:pointer;font-family:var(--font);font-size:12px;font-weight:600;transition:all .15s;white-space:nowrap}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-hover)}
.btn-primary:disabled{opacity:.4;cursor:not-allowed}
.btn-outline{background:var(--white);color:var(--text);border:1.5px solid var(--border)}
.btn-outline:hover{border-color:var(--border2);background:var(--surface)}
.btn-ghost{background:transparent;color:var(--muted);border:none;padding:4px 8px;font-size:11px}
.btn-ghost:hover{color:var(--text)}
.btn-red{background:var(--red-bg);color:var(--red);border:1.5px solid rgba(192,57,43,.2)}
.btn-red:hover{background:#fad5d3}
.btn-red:disabled{opacity:.4;cursor:not-allowed}
.btn-sm{padding:5px 10px;font-size:11px}
.btn-full{width:100%}
.btn-row{display:flex;gap:6px;margin-top:8px}

/* ── Main header ── */
.main-header{padding:10px 14px;background:var(--white);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0}
.main-title{font-size:13px;font-weight:700;flex:1}
.status-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;font-family:var(--mono)}
.s-idle{background:var(--surface);color:var(--muted);border:1px solid var(--border)}
.s-run{background:var(--orange-bg);color:var(--orange);border:1px solid rgba(180,83,9,.2)}
.s-ok{background:var(--green-bg);color:var(--green);border:1px solid rgba(26,127,75,.2)}
.s-err{background:var(--red-bg);color:var(--red);border:1px solid rgba(192,57,43,.2)}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block}
.pulse{animation:pulse .9s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

/* ── Controls bar ── */
.controls{display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--white);border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap}
.queue-lbl{font-size:11px;color:var(--muted);font-family:var(--mono);margin-left:auto}

/* ── Terminal ── */
.term-wrap{background:var(--white);border:1.5px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:12px;box-shadow:var(--shadow)}
.term-bar{padding:7px 12px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
.term-dots{display:flex;gap:4px}
.td{width:9px;height:9px;border-radius:50%}
.td-r{background:#ff5f57}.td-y{background:#ffbd2e}.td-g{background:#28ca41}
.term-lbl{font-family:var(--mono);font-size:10px;color:var(--muted)}
.term-body{padding:10px 12px;font-family:var(--mono);font-size:11px;line-height:1.65;height:200px;overflow-y:auto;color:#374151;background:#fff}
.term-body::-webkit-scrollbar{width:3px}
.term-body::-webkit-scrollbar-thumb{background:var(--border2)}
.log-line{display:block;white-space:pre-wrap;word-break:break-all}
.c-ok{color:var(--green)}.c-err{color:var(--red)}.c-warn{color:var(--orange)}.c-dim{color:var(--muted2)}.c-hi{color:var(--accent)}

/* ── Sección label ── */
.sec{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.sec::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── Job cards ── */
.job-card{background:var(--white);border:1.5px solid var(--border);border-radius:var(--r2);padding:10px 12px;margin-bottom:6px;box-shadow:var(--shadow);display:flex;align-items:flex-start;gap:10px}
.job-num{width:20px;height:20px;border-radius:50%;background:var(--accent-light);color:var(--accent);font-size:10px;font-weight:700;display:grid;place-items:center;flex-shrink:0;margin-top:1px;font-family:var(--mono)}
.job-body{flex:1;min-width:0}
.job-title{font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:2px}
.job-meta{font-family:var(--mono);font-size:10px;color:var(--muted)}
.job-pills{display:flex;gap:3px;flex-wrap:wrap;margin-top:4px}
.pill{font-family:var(--mono);font-size:9px;padding:1px 5px;border-radius:3px;background:var(--surface);border:1px solid var(--border);color:var(--muted)}
.badge{font-size:9px;padding:2px 6px;border-radius:10px;font-weight:700;font-family:var(--mono)}
.b-b{background:var(--accent-light);color:var(--accent)}
.b-p{background:var(--green-bg);color:var(--green)}
.job-acts{display:flex;gap:3px;flex-shrink:0}

/* ── JSON preview ── */
.json-box{background:#fff;border:1.5px solid var(--border);border-radius:var(--r2);padding:10px 12px;font-family:var(--mono);font-size:10px;line-height:1.65;color:#374151;overflow:auto;max-height:180px;white-space:pre;box-shadow:var(--shadow)}
.jk{color:#1a6ef7}.js{color:#1a7f4b}.jn{color:#b45309}.jb{color:#c0392b}

/* ── Historial ── */
.hist-item{background:var(--white);border:1.5px solid var(--border);border-radius:var(--r);padding:8px 12px;margin-bottom:5px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:border-color .15s;box-shadow:var(--shadow)}
.hist-item:hover{border-color:var(--accent)}
.hist-meta{font-family:var(--mono);font-size:10px;color:var(--muted)}
.hist-load{font-size:10px;font-weight:600;color:var(--accent);flex-shrink:0}

/* ── Toast ── */
.toast{position:fixed;bottom:16px;right:16px;background:var(--text);color:#fff;font-size:12px;padding:8px 14px;border-radius:var(--r);opacity:0;transform:translateY(6px);transition:all .2s;z-index:999;pointer-events:none;font-weight:500}
.toast.show{opacity:1;transform:none}
.toast.ok{background:var(--green)}.toast.warn{background:var(--orange)}.toast.err{background:var(--red)}

/* ── Empty ── */
.empty{color:var(--muted2);font-size:11px;text-align:center;padding:16px;font-family:var(--mono)}
</style>
</head>
<body>

<!-- SIDEBAR -->
<aside class="sidebar">
  <div class="sidebar-header">
    <div class="logo-icon">📹</div>
    <div>
      <div class="logo-title">NVR Downloader</div>
      <div class="logo-sub">localhost:3000</div>
    </div>
  </div>

  <div class="sidebar-body">

    <span class="lbl">Tipo de bus</span>
    <div class="tipo-row" style="margin-bottom:8px">
      <div class="tipo-radio">
        <input type="radio" name="tb" id="tb_b" value="BUSETON" checked>
        <label for="tb_b">🚌 BUSETON</label>
      </div>
      <div class="tipo-radio">
        <input type="radio" name="tb" id="tb_p" value="PADRON">
        <label for="tb_p">🚍 PADRÓN</label>
      </div>
    </div>

    <span class="lbl">Identificación</span>
    <div class="row2" style="margin-bottom:6px">
      <div class="field"><input type="text" id="bus_id" placeholder="Z67-4032"></div>
      <div class="field"><input type="text" id="descripcion" placeholder="ACCIDENTES"></div>
    </div>

    <span class="lbl">Conexión NVR</span>
    <div class="field"><input type="text" id="nvr_ip" placeholder="172.23.10.240"></div>
    <div class="row2" style="margin-bottom:6px">
      <div class="field"><input type="text" id="nvr_user" placeholder="admin" value="admin"></div>
      <div class="field"><input type="password" id="nvr_pass" placeholder="contraseña"></div>
    </div>

    <span class="lbl">Fecha y hora del evento</span>
    <div class="row2" style="margin-bottom:6px">
      <div class="field"><input type="date" id="fecha"></div>
      <div class="field"><input type="time" id="hora_inicio" step="1"></div>
    </div>

    <span class="lbl">Duración</span>
    <div class="field" style="margin-bottom:8px">
      <select id="dur">
        <option value="1">1 minuto</option>
        <option value="3">3 minutos</option>
        <option value="5" selected>5 minutos</option>
        <option value="10">10 minutos</option>
      </select>
    </div>

    <div class="cams-header">
      <span class="lbl" style="margin:0">Cámaras</span>
      <div class="cams-actions">
        <button class="btn btn-ghost btn-sm" onclick="selAll()">Todas</button>
        <button class="btn btn-ghost btn-sm" onclick="selNone()">Ninguna</button>
      </div>
    </div>
    <div class="cam-grid" id="cam-grid"></div>

    <div class="btn-row">
      <button class="btn btn-primary btn-full" onclick="addJob()">＋ Agregar</button>
      <button class="btn btn-outline" onclick="clearForm()" title="Limpiar formulario">↺</button>
    </div>

  </div>
</aside>

<!-- MAIN -->
<main class="main">

  <div class="main-header">
    <div class="main-title">Panel de descargas</div>
    <span class="status-pill s-idle" id="spill"><span class="dot"></span> Inactivo</span>
  </div>

  <div class="controls">
    <button class="btn btn-primary btn-sm" id="btn-start" onclick="startDL()" disabled>▶ Iniciar descarga</button>
    <button class="btn btn-red btn-sm" id="btn-stop" onclick="stopDL()" disabled>■ Detener</button>
    <button class="btn btn-ghost btn-sm" onclick="clearTerm()">⌫ Limpiar log</button>
    <span class="queue-lbl" id="qlbl"></span>
  </div>

  <div class="main-top">

    <!-- TERMINAL -->
    <div class="term-wrap">
      <div class="term-bar">
        <div class="term-dots"><div class="td td-r"></div><div class="td td-y"></div><div class="td td-g"></div></div>
        <span class="term-lbl" id="term-lbl">vivotek-download.js · esperando</span>
      </div>
      <div class="term-body" id="term"></div>
    </div>

    <!-- COLA -->
    <div class="sec" style="margin-top:4px">Cola de trabajos</div>
    <div id="jobs-list"></div>

    <!-- JSON -->
    <div class="sec" style="margin-top:10px">jobs.json</div>
    <div class="json-box" id="jprev"><span style="color:var(--muted2)">// Sin trabajos</span></div>
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="dlJSON()" id="btn-dl" disabled>⬇ Descargar</button>
      <button class="btn btn-outline btn-sm" onclick="cpJSON()" id="btn-cp" disabled>⎘ Copiar</button>
      <button class="btn btn-red btn-sm" onclick="clearJobs()" id="btn-cl" disabled>🗑 Vaciar</button>
    </div>

    <!-- HISTORIAL -->
    <div class="sec" style="margin-top:14px">Historial</div>
    <div id="hist-list"></div>
    <button class="btn btn-ghost btn-sm" onclick="clearHist()" style="margin-top:4px">Borrar historial</button>

  </div>
</main>

<div class="toast" id="toast"></div>

<script>
// ═════════════════════════════════════════
// DATOS
// ═════════════════════════════════════════
const CAMS = {
  BUSETON:[
    {s:"BSF",c:0,i:"🔭",d:"Frontal"},
    {s:"BSO",c:1,i:"👤",d:"Operador"},
    {s:"BS1",c:2,i:"🪑",d:"Int.1"},
    {s:"BS2",c:5,i:"🪑",d:"Int.2"},
    {s:"BST",c:6,i:"🔭",d:"Trasera"},
  ],
  PADRON:[
    {s:"PDF",c:0,i:"🔭",d:"Frontal"},
    {s:"PDO",c:1,i:"👤",d:"Operador"},
    {s:"PD1",c:2,i:"🪑",d:"Int.1"},
    {s:"PD2",c:3,i:"🪑",d:"Int.2"},
    {s:"PD3",c:4,i:"🪑",d:"Int.3"},
    {s:"PD4",c:5,i:"🪑",d:"Int.4"},
    {s:"PDT",c:6,i:"🔭",d:"Trasera"},
  ],
};

let jobs = JSON.parse(localStorage.getItem("nvr_jobs")||"[]");

// ═════════════════════════════════════════
// FECHA Y HORA POR DEFECTO
// ═════════════════════════════════════════
(function initDateTime(){
  const now = new Date();
  const pad = n => String(n).padStart(2,"0");
  const fechaStr = now.getFullYear()+"-"+pad(now.getMonth()+1)+"-"+pad(now.getDate());
  const horaStr  = pad(now.getHours())+":"+pad(now.getMinutes())+":"+pad(now.getSeconds());
  document.getElementById("fecha").value      = fechaStr;
  document.getElementById("hora_inicio").value = horaStr;
})();

// ═════════════════════════════════════════
// CÁMARAS
// ═════════════════════════════════════════
function renderCams(){
  const tipo = document.querySelector('input[name="tb"]:checked').value;
  const list = CAMS[tipo]||CAMS.BUSETON;
  const grid = document.getElementById("cam-grid");
  grid.className = "cam-grid"+(tipo==="PADRON"?" padron":"");
  grid.innerHTML = list.map(c=>\`
    <div>
      <input class="cam-input" type="checkbox" id="c\${c.c}" value="\${c.c}" data-s="\${c.s}" checked>
      <label class="cam-tile" for="c\${c.c}">
        <span class="cam-icon">\${c.i}</span>
        <span class="cam-s">\${c.s}</span>
        <span class="cam-n">ch.\${c.c}</span>
      </label>
    </div>\`).join("");
}
document.querySelectorAll('input[name="tb"]').forEach(r=>r.addEventListener("change",renderCams));
function selAll(){document.querySelectorAll(".cam-input").forEach(x=>x.checked=true)}
function selNone(){document.querySelectorAll(".cam-input").forEach(x=>x.checked=false)}

// ═════════════════════════════════════════
// FORM
// ═════════════════════════════════════════
function getForm(){
  const tipo = document.querySelector('input[name="tb"]:checked').value;
  const cams = [...document.querySelectorAll(".cam-input:checked")].map(x=>parseInt(x.value));
  return {
    descripcion:     (document.getElementById("descripcion").value.trim()||"EVENTO").toUpperCase(),
    bus_id:          document.getElementById("bus_id").value.trim(),
    tipo_bus:        tipo,
    nvr_ip:          document.getElementById("nvr_ip").value.trim(),
    nvr_user:        document.getElementById("nvr_user").value.trim(),
    nvr_pass:        document.getElementById("nvr_pass").value,
    fecha:           document.getElementById("fecha").value,
    hora_inicio:     document.getElementById("hora_inicio").value||"00:00:00",
    duracion_minutos:parseInt(document.getElementById("dur").value),
    formato:         "3gp",
    camaras:         cams,
    _ts:             new Date().toISOString(),
  };
}

function addJob(){
  const d = getForm();
  if(!d.bus_id)         return toast("⚠ Ingresa Bus ID","warn");
  if(!d.nvr_ip)         return toast("⚠ Ingresa IP del NVR","warn");
  if(!d.fecha)          return toast("⚠ Selecciona fecha","warn");
  if(!d.hora_inicio)    return toast("⚠ Selecciona hora","warn");
  if(!d.camaras.length) return toast("⚠ Selecciona cámaras","warn");
  jobs.push(d);
  save(); renderAll(); toast("✓ Trabajo agregado");
}

function removeJob(i){ jobs.splice(i,1); save(); renderAll(); }

function loadJob(i){
  const j=jobs[i];
  document.getElementById("bus_id").value    = j.bus_id||"";
  document.getElementById("descripcion").value = j.descripcion||"";
  document.getElementById("nvr_ip").value    = j.nvr_ip||"";
  document.getElementById("nvr_user").value  = j.nvr_user||"admin";
  document.getElementById("nvr_pass").value  = j.nvr_pass||"";
  document.getElementById("fecha").value     = j.fecha||"";
  document.getElementById("hora_inicio").value = j.hora_inicio||"";
  document.getElementById("dur").value       = String(j.duracion_minutos||5);
  const tr = document.querySelector(\`input[value="\${j.tipo_bus||'BUSETON'}"]\`);
  if(tr){tr.checked=true; renderCams();}
  setTimeout(()=>{
    document.querySelectorAll(".cam-input").forEach(x=>{
      x.checked=(j.camaras||[]).includes(parseInt(x.value));
    });
  },50);
}

function clearForm(){
  document.getElementById("bus_id").value="";
  document.getElementById("descripcion").value="";
  document.getElementById("nvr_ip").value="";
  document.getElementById("nvr_pass").value="";
  document.getElementById("dur").value="5";
  document.querySelector('input[value="BUSETON"]').checked=true;
  renderCams();
  // Resetear a ahora
  const now=new Date(),pad=n=>String(n).padStart(2,"0");
  document.getElementById("fecha").value=now.getFullYear()+"-"+pad(now.getMonth()+1)+"-"+pad(now.getDate());
  document.getElementById("hora_inicio").value=pad(now.getHours())+":"+pad(now.getMinutes())+":"+pad(now.getSeconds());
}

function clearJobs(){
  if(!confirm("¿Vaciar la cola?")) return;
  if(jobs.length) saveHist(jobs);
  jobs=[]; save(); renderAll(); toast("Cola vaciada");
}

function save(){
  localStorage.setItem("nvr_jobs",JSON.stringify(jobs));
  const clean=jobs.map(({_ts,...j})=>j);
  fetch("/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(clean)});
}

// ═════════════════════════════════════════
// RENDER
// ═════════════════════════════════════════
function renderAll(){ renderJobs(); renderJSON(); renderHist(); updateBtns(); }

function renderJobs(){
  const el=document.getElementById("jobs-list");
  document.getElementById("qlbl").textContent=jobs.length?\`\${jobs.length} trabajo(s) en cola\`:"";
  if(!jobs.length){ el.innerHTML='<div class="empty">Sin trabajos aún.</div>'; return; }
  el.innerHTML=jobs.map((j,i)=>{
    const bc=j.tipo_bus==="PADRON"?"b-p":"b-b";
    const pills=(j.camaras||[]).map(c=>\`<span class="pill">ch.\${c}</span>\`).join("");
    return \`<div class="job-card">
      <div class="job-num">\${i+1}</div>
      <div class="job-body">
        <div class="job-title">
          \${j.bus_id||j.nvr_ip}
          <span class="badge \${bc}">\${j.tipo_bus||"GEN"}</span>
          <span style="color:var(--muted);font-size:11px;font-weight:400">\${j.descripcion}</span>
        </div>
        <div class="job-meta">\${j.fecha} · \${j.hora_inicio} · \${j.duracion_minutos}min · \${j.nvr_ip}</div>
        <div class="job-pills">\${pills}</div>
      </div>
      <div class="job-acts">
        <button class="btn btn-ghost btn-sm" onclick="loadJob(\${i})" title="Editar">✏️</button>
        <button class="btn btn-red btn-sm" onclick="removeJob(\${i})">✕</button>
      </div>
    </div>\`;
  }).join("");
}

function hl(json){
  return json
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/("(\\\\u[\\da-fA-F]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g,m=>{
      if(/^".*":$/.test(m)) return \`<span class="jk">\${m}</span>\`;
      if(/^"/.test(m))      return \`<span class="js">\${m}</span>\`;
      if(/true|false/.test(m)) return \`<span class="jb">\${m}</span>\`;
      return \`<span class="jn">\${m}</span>\`;
    });
}

function renderJSON(){
  const el=document.getElementById("jprev");
  if(!jobs.length){ el.innerHTML='<span style="color:var(--muted2)">// Sin trabajos</span>'; return; }
  const clean=jobs.map(({_ts,...j})=>j);
  el.innerHTML=hl(JSON.stringify(clean,null,2));
}

function updateBtns(){
  const has=jobs.length>0;
  document.getElementById("btn-start").disabled=!has;
  document.getElementById("btn-dl").disabled=!has;
  document.getElementById("btn-cp").disabled=!has;
  document.getElementById("btn-cl").disabled=!has;
}

// ═════════════════════════════════════════
// DESCARGA SSE
// ═════════════════════════════════════════
let evtSrc=null;

function setStatus(s){
  const el=document.getElementById("spill");
  const lbl=document.getElementById("term-lbl");
  const M={
    idle: {cls:"s-idle",  t:"Inactivo",      l:"· esperando"},
    run:  {cls:"s-run",   t:"Descargando…",  l:"· en ejecución"},
    ok:   {cls:"s-ok",    t:"Completado ✓",  l:"· finalizado"},
    err:  {cls:"s-err",   t:"Con errores",   l:"· errores"},
    stop: {cls:"s-idle",  t:"Detenido",      l:"· detenido"},
  };
  const m=M[s]||M.idle;
  el.className="status-pill "+m.cls;
  el.innerHTML=\`<span class="dot\${s==="run"?" pulse":""}" ></span> \${m.t}\`;
  lbl.textContent="vivotek-download.js "+m.l;
  document.getElementById("btn-start").disabled=(s==="run")||!jobs.length;
  document.getElementById("btn-stop").disabled=(s!=="run");
}

function classify(l){
  if(/✓|OK|completad|Listo|Guardado/i.test(l)) return "c-ok";
  if(/✗|Error|401|fallo|Fallo/i.test(l))       return "c-err";
  if(/⚠|warn|Timeout/i.test(l))                return "c-warn";
  if(/╔|╚|║|═/.test(l))                        return "c-hi";
  if(/Poll|↓|Creando|Procesando|Descargando/i.test(l)) return "c-dim";
  return "";
}

function appendLog(line,cls){
  const t=document.getElementById("term");
  const s=document.createElement("span");
  s.className="log-line "+(cls||classify(line));
  s.textContent=line;
  t.appendChild(s);
  t.appendChild(document.createTextNode("\\n"));
  t.scrollTop=t.scrollHeight;
}

function clearTerm(){ document.getElementById("term").innerHTML=""; }

async function startDL(){
  if(!jobs.length) return;
  clearTerm(); setStatus("run");
  appendLog("▶ Iniciando…","c-hi");
  if(evtSrc) evtSrc.close();
  evtSrc=new EventSource("/progress");
  evtSrc.onmessage=e=>{
    const d=JSON.parse(e.data);
    if(d.type==="log")  appendLog(d.line);
    if(d.type==="err")  appendLog(d.line,"c-err");
    if(d.type==="done"){
      setStatus(d.code===0?"ok":"err");
      appendLog(d.code===0?"── ✓ Descarga completada ──":"── ✗ Proceso con errores ──",d.code===0?"c-ok":"c-err");
      evtSrc.close();
      if(d.code===0){ saveHist(jobs); renderHist(); }
    }
    if(d.type==="stopped"){ setStatus("stop"); evtSrc.close(); }
  };
  await fetch("/start",{method:"POST"});
}

async function stopDL(){ await fetch("/stop",{method:"POST"}); }

// ═════════════════════════════════════════
// JSON EXPORT
// ═════════════════════════════════════════
function getClean(){ return JSON.stringify(jobs.map(({_ts,...j})=>j),null,2); }
function dlJSON(){
  const b=new Blob([getClean()],{type:"application/json"});
  const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(b),download:"jobs.json"});
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast("jobs.json descargado");
}
function cpJSON(){
  navigator.clipboard.writeText(getClean()).then(()=>toast("Copiado al portapapeles"));
}

// ═════════════════════════════════════════
// HISTORIAL
// ═════════════════════════════════════════
function saveHist(list){
  const h=JSON.parse(localStorage.getItem("nvr_hist")||"[]");
  h.unshift({ts:new Date().toISOString(),count:list.length,
    buses:list.map(j=>j.bus_id||j.nvr_ip).join(", "),
    fecha:list[0]?.fecha,
    jobs:list.map(({_ts,...j})=>j)});
  localStorage.setItem("nvr_hist",JSON.stringify(h.slice(0,20)));
}

function renderHist(){
  const h=JSON.parse(localStorage.getItem("nvr_hist")||"[]");
  const el=document.getElementById("hist-list");
  if(!h.length){ el.innerHTML='<div class="empty">Sin historial.</div>'; return; }
  el.innerHTML=h.map((e,i)=>{
    const d=new Date(e.ts);
    const ds=d.toLocaleDateString("es-CO",{day:"2-digit",month:"short"});
    const ts=d.toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"});
    return \`<div class="hist-item" onclick="loadHist(\${i})">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;margin-bottom:1px">\${e.buses}</div>
        <div class="hist-meta">\${e.count} trabajo(s) · \${e.fecha||""}</div>
      </div>
      <div style="font-size:10px;color:var(--muted2);font-family:var(--mono);flex-shrink:0">\${ds} \${ts}</div>
      <div class="hist-load">Cargar →</div>
    </div>\`;
  }).join("");
}

function loadHist(i){
  const h=JSON.parse(localStorage.getItem("nvr_hist")||"[]");
  if(!h[i]||!confirm("¿Cargar estos trabajos? Reemplazará la cola actual.")) return;
  jobs=h[i].jobs.map(j=>({...j,_ts:h[i].ts}));
  save(); renderAll(); toast("Historial cargado");
}

function clearHist(){
  if(!confirm("¿Borrar todo el historial?")) return;
  localStorage.removeItem("nvr_hist"); renderHist();
}

// ═════════════════════════════════════════
// TOAST
// ═════════════════════════════════════════
let tTimer;
function toast(msg,type="ok"){
  const el=document.getElementById("toast");
  el.textContent=msg; el.className="toast show "+(type||"ok");
  clearTimeout(tTimer); tTimer=setTimeout(()=>el.classList.remove("show"),2000);
}

// ═════════════════════════════════════════
// INIT
// ═════════════════════════════════════════
renderCams();
renderAll();
fetch("/jobs").then(r=>r.json()).then(d=>{
  if(Array.isArray(d)&&d.length){
    jobs=d.map(j=>({...j,_ts:new Date().toISOString()}));
    renderAll();
  }
}).catch(()=>{});
</script>
</body>
</html>`;
