const API = "https://api.gofile.io";
const $ = s => document.querySelector(s);
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
let token = store.get("token", ""), wt = store.get("wt", ""), items = store.get("items", []);

const fmt = n => { if(!n && n!==0) return ""; const u=["B","KB","MB","GB"]; let i=0; while(n>=1024&&i<3){n/=1024;i++} return n.toFixed(i?1:0)+" "+u[i]; };
const say = t => $("#msg").textContent = t || "";
const auth = () => token ? { Authorization: "Bearer " + token } : {};

function esc(s){ const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }

/* ---------- Shredder ---------- */
const SH = {
  width:340, height:460, feedSpeed:180, bite:18, stripWidth:10, curl:1,
  fallHeight:140, inset:14, gap:10, slitHeight:4, autoFeed:true,
  dragTilt:6, lift:1.02, slitColor:"#3f3f46", color:"#f5f5f5", disabled:false, rowHeight:64
};
const shEl = $("#shredder"), area = $("#list");
shEl.style.cssText = `max-width:${SH.width}px;height:${SH.height}px;--paper:${SH.color};--slit:${SH.slitColor};--inset:${SH.inset}px;--slitH:${SH.slitHeight}px;--fall:${SH.fallHeight}px`;
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const pos = k => k * (SH.rowHeight + SH.gap);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const slitY = () => area.getBoundingClientRect().bottom + SH.slitHeight / 2;
const q = s => esc(s).replace(/"/g, "&quot;");
let active = null, chunks = [], raf = 0, lastT = 0, pendingRender = false;

function render(){
  if(active){ pendingRender = true; return; }
  pendingRender = false;
  if(!items.length){ area.innerHTML = '<p class="empty">Nothing here yet. Drop a file above to upload it.</p>'; return; }
  const inner = document.createElement("div");
  inner.className = "sh-inner";
  inner.style.height = pos(items.length) - SH.gap + "px";
  items.forEach((it, i) => {
    const r = document.createElement("div");
    const live = !!it.link;
    r.className = "row"; r.dataset.i = i; r.style.top = pos(i) + "px";
    r.innerHTML = `<span class="grip${live && !SH.disabled ? "" : " off"}" ${live && !SH.disabled ? 'title="Drag down into the slit to delete"' : ""}></span>
      <div class="info">${live ? `<a class="name" href="${q(it.link)}" target="_blank" rel="noopener">${esc(it.name)}</a>` : `<span class="name">${esc(it.name)}</span>`}
      <div class="meta">${fmt(it.size)}${it.date ? " · " + new Date(it.date).toLocaleDateString() : ""}${it.err ? " · " + esc(it.err) : ""}</div></div>
      ${live ? `<div class="acts"><button data-a="copy">Copy</button>${SH.disabled ? "" : '<button class="del" data-a="del">Delete</button>'}</div>` : ""}
      ${it.progress != null && !live && !it.err ? `<div class="bar"><i style="width:${it.progress}%"></i></div>` : ""}`;
    inner.appendChild(r);
  });
  area.replaceChildren(inner);
}

const rowsByIndex = () => [...area.querySelectorAll(".row")].sort((a, b) => a.dataset.i - b.dataset.i);

function ghostOf(st, left, top){
  const c = st.row.cloneNode(true);
  c.className = "row ghost"; c.removeAttribute("data-i"); c.inert = true; c.setAttribute("aria-hidden", "true");
  c.style.cssText = `left:${left}px;top:${top}px;right:auto;width:${st.rect0.width}px;transform:none`;
  return c;
}
function makeStrips(st){
  const sr = shEl.getBoundingClientRect(), r = st.rect0, n = Math.ceil(r.width / SH.stripWidth);
  const layer = document.createElement("div");
  layer.className = "sh-layer";
  layer.style.cssText = `left:${r.left - sr.left}px;top:${slitY() - sr.top}px;width:${r.width}px`;
  shEl.appendChild(layer);
  st.layer = layer; st.strips = []; st.lastS = 0;
  for(let i = 0; i < n; i++){
    const el = document.createElement("div");
    el.className = "sh-strip";
    el.style.cssText = `left:${i * SH.stripWidth}px;width:${SH.stripWidth}px`;
    const c = ghostOf(st, -i * SH.stripWidth, 0);
    el.appendChild(c); layer.appendChild(el);
    st.strips.push({ el, c, i, tip:0, hang:SH.bite * rnd(1.6, 3.6), rot:rnd(-1, 1) * 10 * SH.curl });
  }
}
// A bite breaks off the lowest part of a strip and lets it fall.
function shedChunk(st, p, s, y, len){
  const el = document.createElement("div");
  el.className = "sh-chunk";
  el.style.cssText = `left:${p.i * SH.stripWidth}px;top:${y}px;width:${SH.stripWidth}px;height:${len}px`;
  el.appendChild(ghostOf(st, -p.i * SH.stripWidth, -(st.rowH - s + y)));
  st.layer.appendChild(el);
  chunks.push({ el, y0:y, y:0, x:0, vy:SH.feedSpeed, vx:rnd(-1, 1) * 20 * SH.curl, r:p.rot * .5, vr:rnd(-1, 1) * 240 * SH.curl });
}
function updateStrips(st, s){
  if(!st.strips) makeStrips(st);
  const ds = s - st.lastS; st.lastS = s;
  for(const p of st.strips){
    p.tip = Math.max(0, p.tip + ds);
    if(p.tip >= p.hang){ shedChunk(st, p, s, p.tip - SH.bite, SH.bite); p.tip -= SH.bite; p.hang = SH.bite * rnd(1.6, 3.6); }
    p.el.style.height = p.tip + "px";
    p.el.style.transform = `rotate(${p.rot * Math.min(1, p.tip / p.hang)}deg)`;
    p.c.style.top = -(st.rowH - s) + "px";
  }
}
function place(st){
  st.s = st.rect0.bottom + st.dy - slitY();
  const crossed = st.s > 0;
  st.row.style.transform = `translateY(${st.dy}px)` + (crossed || st.mode === "feed" ? "" : ` rotate(${st.tilt}deg) scale(${SH.lift})`);
  if(crossed || st.strips) updateStrips(st, clamp(st.s, 0, st.rowH));
}
function beginDrag(row){
  area.classList.add("noscroll");
  const rect0 = row.getBoundingClientRect(), i = +row.dataset.i;
  return { row, it:items[i], i, target:i, rect0, rowH:rect0.height, dy:0, tilt:0, mode:"drag", s:-1e9, strips:null, lastS:0 };
}
function reorderPreview(st){
  st.target = clamp(Math.round((pos(st.i) + st.dy) / (SH.rowHeight + SH.gap)), 0, items.length - 1);
  rowsByIndex().forEach((r, j) => {
    if(j === st.i) return;
    let k = j;
    if(st.target > st.i && j > st.i && j <= st.target) k = j - 1;
    else if(st.target < st.i && j >= st.target && j < st.i) k = j + 1;
    r.style.top = pos(k) + "px";
  });
}
function settleBack(st){
  st.row.classList.remove("dragging");
  st.row.style.transform = "";
  st.row.style.top = pos(st.target) + "px";
  if(st.target !== st.i){
    const next = [...items], rows = rowsByIndex();
    next.splice(st.target, 0, next.splice(st.i, 1)[0]);
    rows.splice(st.target, 0, rows.splice(st.i, 1)[0]);
    rows.forEach((r, k) => r.dataset.i = k);
    items = next; persist();   // reorder
  }
  area.classList.remove("noscroll"); active = null;
  if(pendingRender) render();
}
function startFeed(st){
  st.mode = "feed";
  if(REDUCE){ finish(st); return; }
  kick();
}
function finish(st){
  for(const p of st.strips || []){ if(p.tip > 1) shedChunk(st, p, st.rowH, 0, p.tip); p.el.remove(); }
  if(st.layer){ st.layer.dataset.done = "1"; if(!st.layer.querySelector(".sh-chunk")) st.layer.remove(); }
  st.row.remove();
  area.classList.remove("noscroll");
  active = null;
  items = items.filter(x => x !== st.it); persist();
  const rows = rowsByIndex();
  rows.forEach((r, k) => { r.dataset.i = k; r.style.top = pos(k) + "px"; });
  if(!items.length) render(); else area.firstChild.style.height = pos(items.length) - SH.gap + "px";
  shredded(st.it, st.i);
  if(pendingRender) render();
}
async function shredded(it, idx){
  if(token && it.id){
    try {
      const r = await fetch(API + "/contents", { method:"DELETE", headers:{ "Content-Type":"application/json", ...auth() }, body: JSON.stringify({ contentsId: it.id }) });
      const j = await r.json();
      if(j.status !== "ok") throw new Error(j.status);
      say("");
    } catch(e){
      items.splice(idx, 0, it); persist(); render();
      say("Could not delete from GoFile: " + e.message + ". The file is back in your list.");
    }
  } else say("Removed from this list. Guest uploads can't be deleted from GoFile.");
}
function kick(){ if(!raf){ lastT = performance.now(); raf = requestAnimationFrame(loop); } }
function loop(t){
  const dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
  const st = active;
  if(st && st.mode === "feed"){
    st.dy += SH.feedSpeed * (st.s < 0 ? 4 : 1) * dt;   // travel faster until the row reaches the slit
    place(st);
    if(st.s >= st.rowH) finish(st);
  }
  for(let k = chunks.length - 1; k >= 0; k--){
    const c = chunks[k], a = c.y0 + c.y;
    c.vy += 1500 * dt; c.y += c.vy * dt; c.x += c.vx * dt; c.r += c.vr * dt;
    c.el.style.transform = `translate(${c.x}px,${c.y}px) rotate(${c.r}deg)`;
    c.el.style.opacity = 1 - clamp((a - SH.fallHeight * .55) / (SH.fallHeight * .45), 0, 1);
    if(a >= SH.fallHeight){
      const l = c.el.parentNode; c.el.remove(); chunks.splice(k, 1);
      if(l && l.dataset.done && !l.querySelector(".sh-chunk")) l.remove();
    }
  }
  raf = (active || chunks.length) ? requestAnimationFrame(loop) : 0;
}

area.addEventListener("pointerdown", ev => {
  const g = ev.target.closest(".grip:not(.off)");
  if(!g || active || SH.disabled) return;
  ev.preventDefault();
  const row = g.closest(".row");
  active = beginDrag(row);
  Object.assign(active, { x0:ev.clientX, y0:ev.clientY, pid:ev.pointerId });
  row.classList.add("dragging");
  g.setPointerCapture(ev.pointerId);
});
area.addEventListener("pointermove", ev => {
  const st = active;
  if(!st || st.mode !== "drag" || ev.pointerId !== st.pid) return;
  st.dy = ev.clientY - st.y0;
  st.tilt = clamp((ev.clientX - st.x0) / 40, -1, 1) * SH.dragTilt;
  reorderPreview(st); place(st);
  if(st.s > 0 && SH.autoFeed) startFeed(st);
});
const endDrag = ev => {
  const st = active;
  if(!st || st.mode !== "drag" || ev.pointerId !== st.pid) return;
  if(st.s > 0) startFeed(st); else settleBack(st);
};
area.addEventListener("pointerup", endDrag);
area.addEventListener("pointercancel", endDrag);
function persist(){ store.set("items", items.filter(i => i.link).slice(0, 200)); }

async function getServer(){
  const r = await fetch(API + "/servers");
  const j = await r.json();
  if(j.status !== "ok") throw new Error("Could not get an upload server");
  return j.data.servers[0].name;
}

function uploadOne(file, server, entry){
  return new Promise(resolve => {
    const fd = new FormData();
    fd.append("file", file);
    const x = new XMLHttpRequest();
    x.open("POST", `https://${server}.gofile.io/contents/uploadfile`);
    if(token) x.setRequestHeader("Authorization", "Bearer " + token);
    x.upload.onprogress = e => { if(e.lengthComputable){ entry.progress = Math.round(e.loaded/e.total*100); render(); } };
    x.onload = () => {
      try {
        const j = JSON.parse(x.responseText);
        if(j.status !== "ok") throw new Error(j.status || "Upload failed");
        entry.link = j.data.downloadPage; entry.id = j.data.id || j.data.fileId; entry.date = Date.now();
      } catch(e){ entry.err = "Upload failed: " + e.message; }
      resolve();
    };
    x.onerror = () => { entry.err = "Network error. Check your connection and try again."; resolve(); };
    x.send(fd);
  });
}

async function handleFiles(files){
  if(!files.length) return;
  say("");
  let server;
  try { server = await getServer(); } catch(e){ say(e.message + ". Try again in a moment."); return; }
  for(const f of files){
    const entry = { name: f.name, size: f.size, progress: 0 };
    items.unshift(entry); render();
    await uploadOne(f, server, entry);
    render(); persist();
  }
}

const drop = $("#drop");
["dragenter","dragover"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", ev => handleFiles([...ev.dataTransfer.files]));
$("#picker").addEventListener("change", ev => { handleFiles([...ev.target.files]); ev.target.value = ""; });

$("#list").addEventListener("click", async ev => {
  const b = ev.target.closest("button"); if(!b) return;
  const row = b.closest(".row"), it = items[+row.dataset.i], a = b.dataset.a;
  if(a === "copy"){ try { await navigator.clipboard.writeText(it.link); b.textContent = "Copied"; setTimeout(()=>b.textContent="Copy",1500); } catch(e){ say("Copy failed. Open the link and copy it from the address bar."); } }
  if(a === "del" && !active){
    if(!confirm(`Delete "${it.name}"? This can't be undone.`)) return;
    const st = beginDrag(row);
    active = st; row.classList.add("dragging"); startFeed(st);
  }
});

$("#clear").addEventListener("click", () => { items = []; persist(); store.set("items", []); render(); });

$("#load").addEventListener("click", async () => {
  if(!token){ say("Connect your API key (Change API key) to load account files."); return; }
  say("Loading…");
  try {
    let r = await fetch(API + "/accounts/getid", { headers: auth() });
    let j = await r.json(); if(j.status !== "ok") throw new Error("Token not accepted");
    r = await fetch(`${API}/accounts/${j.data.id}`, { headers: auth() });
    j = await r.json(); if(j.status !== "ok") throw new Error("Could not read account");
    const root = j.data.rootFolder;
    r = await fetch(`${API}/contents/${root}${wt ? "?wt=" + encodeURIComponent(wt) : ""}`, { headers: auth() });
    j = await r.json(); if(j.status !== "ok") throw new Error(j.status + (wt ? "" : " (a website token may be required)"));
    const kids = Object.values(j.data.children || {}).filter(c => c.type === "file");
    const have = new Set(items.map(i => i.id));
    kids.forEach(c => { if(!have.has(c.id)) items.push({ id:c.id, name:c.name, size:c.size, link:c.link || `https://gofile.io/d/${root}`, date:(c.createTime||0)*1000 }); });
    say(kids.length ? "" : "Your account root folder has no files."); render(); persist();
  } catch(e){ say("Could not load files: " + e.message); }
});

/* ---------- Lock screen ---------- */
// Leave empty on first run: the lock screen will help you create the hash.
const PASS_HASH = "";
const SALT = "stash-v1";
const lockEl = $("#lock"), keyEl = $("#keyPage"), appEl = $("#app"), pw = $("#pw"), lockErr = $("#lockErr");
let fails = 0;

async function hashPw(p){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(p), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt:enc.encode(SALT), iterations:200000, hash:"SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,"0")).join("");
}
function openSite(){
  try { sessionStorage.setItem("stash-open", "1"); } catch(e){}
  lockEl.hidden = true; route();
}
// After the lock: show the app if a key is saved (or guest was chosen), otherwise ask for the key.
function route(){
  let guest = false;
  try { guest = sessionStorage.getItem("stash-guest") === "1"; } catch(e){}
  if(token || guest){
    keyEl.hidden = true; appEl.hidden = false;
    $("#acctState").textContent = token ? "Using your GoFile API key" : "Guest mode: files can't be deleted later";
    render();
  } else {
    appEl.hidden = true; keyEl.hidden = false; $("#keyInput").focus();
  }
}
function lockSite(){
  try { sessionStorage.removeItem("stash-open"); } catch(e){}
  appEl.hidden = true; keyEl.hidden = true; lockEl.hidden = false; pw.value = ""; pw.focus();
}
function wrongTry(msg){
  lockErr.textContent = msg;
  lockEl.classList.remove("shake"); void lockEl.offsetWidth; lockEl.classList.add("shake");
}

if(!PASS_HASH){
  $("#lockHelp").textContent = "No password is set yet. Choose one to create your lock.";
  $("#lockBtn").textContent = "Create password";
  pw.autocomplete = "new-password";
}

$("#lockForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  lockErr.textContent = "";
  if(!(window.crypto && crypto.subtle)){ lockErr.textContent = "This page must be opened over https or localhost to use the lock."; return; }
  const h = await hashPw(pw.value);
  if(!PASS_HASH){
    $("#hashOut").value = `const PASS_HASH = "${h}";`;
    $("#setupOut").hidden = false; $("#lockBtn").hidden = true; pw.hidden = true;
    return;
  }
  if(h === PASS_HASH){ fails = 0; openSite(); return; }
  fails++;
  if(fails >= 5){
    $("#lockBtn").disabled = true;
    wrongTry("Too many attempts. Wait 30 seconds.");
    setTimeout(() => { $("#lockBtn").disabled = false; fails = 0; lockErr.textContent = ""; }, 30000);
  } else wrongTry("Wrong password. Try again.");
  pw.value = ""; pw.focus();
});

$("#copyHash").addEventListener("click", async ev => {
  try { await navigator.clipboard.writeText($("#hashOut").value); ev.target.textContent = "Copied"; } catch(e){ $("#hashOut").select(); }
});
$("#skipLock").addEventListener("click", openSite);
$("#relock").addEventListener("click", () => { if(PASS_HASH) lockSite(); else say("Set a password first. Reload the page to create one."); });

/* ---------- API key page ---------- */
$("#keyForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("#keyErr"), btn = $("#keyBtn"), t = $("#keyInput").value.trim();
  err.textContent = "";
  if(!t){ err.textContent = "Enter your API key, or continue as guest."; return; }
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    const r = await fetch(API + "/accounts/getid", { headers: { Authorization: "Bearer " + t } });
    const j = await r.json();
    if(j.status !== "ok") throw new Error("rejected");
    token = t; wt = $("#wtInput").value.trim();
    store.set("token", token); store.set("wt", wt);
    $("#keyInput").value = "";
    say(""); route();
  } catch(e){
    err.textContent = e.message === "rejected"
      ? "GoFile didn't accept that key. Check it and try again."
      : "Couldn't reach GoFile. Check your connection and try again.";
  } finally { btn.disabled = false; btn.textContent = "Connect"; }
});
$("#guestBtn").addEventListener("click", () => {
  token = ""; store.set("token", "");
  try { sessionStorage.setItem("stash-guest", "1"); } catch(e){}
  say(""); route();
});
$("#changeKey").addEventListener("click", () => {
  try { sessionStorage.removeItem("stash-guest"); } catch(e){}
  appEl.hidden = true; keyEl.hidden = false;
  $("#keyErr").textContent = ""; $("#wtInput").value = wt; $("#keyInput").focus();
});

try { if(PASS_HASH && sessionStorage.getItem("stash-open") === "1") openSite(); } catch(e){}
render();
