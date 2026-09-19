import { Room } from './room.js';
export { Room };

const ROOM_ID_RE = /^[A-Z0-9-]{1,20}$/;

function randomRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let id = '';
  for (let i = 0; i < 6; i++)
    id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function normalizeRoomId(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip Vietnamese diacritics
    .replace(/đ/gi, 'd')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 20);
  return s;
}

async function claimRoom(env, roomId) {
  const id = env.ROOMS.idFromName(roomId);
  const stub = env.ROOMS.get(id);
  const res = await stub.fetch('https://internal/claim', { method: 'POST' });
  return res.status === 200;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/') {
      return html(LANDING_HTML);
    }

    if (path === '/api/rooms' && request.method === 'POST') {
      let body = {};
      try {
        body = await request.json();
      } catch {
        // no body / not JSON — treat as "no name requested"
      }
      const requestedName = normalizeRoomId(body.name);

      if (requestedName) {
        if (!ROOM_ID_RE.test(requestedName)) {
          return json({ error: 'invalid_name' }, 400);
        }
        const claimed = await claimRoom(env, requestedName);
        if (!claimed) {
          return json({ error: 'name_taken' }, 409);
        }
        return json({ roomId: requestedName });
      }

      // No name given — generate a random id, retrying on the (very rare) collision.
      for (let i = 0; i < 5; i++) {
        const roomId = randomRoomId();
        if (await claimRoom(env, roomId)) {
          return json({ roomId });
        }
      }
      return json({ error: 'server_busy' }, 500);
    }

    if (path === '/api/rooms/check' && request.method === 'POST') {
      let body = {};
      try {
        body = await request.json();
      } catch {
        // no body / not JSON
      }
      const roomId = normalizeRoomId(body.name);
      if (!ROOM_ID_RE.test(roomId)) {
        return json({ error: 'invalid_name' }, 400);
      }
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      const res = await stub.fetch('https://internal/exists');
      const data = await res.json();
      return json({ roomId, exists: !!data.exists });
    }

    const roomPage = path.match(/^\/r\/([A-Za-z0-9-]{1,20})$/);
    if (roomPage && ROOM_ID_RE.test(roomPage[1].toUpperCase())) {
      return html(ROOM_HTML);
    }

    const roomWs = path.match(/^\/r\/([A-Za-z0-9-]{1,20})\/ws$/);
    if (roomWs && ROOM_ID_RE.test(roomWs[1].toUpperCase())) {
      const roomId = roomWs[1].toUpperCase();
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};

function html(body) {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json' },
  });
}

const LANDING_HTML = /* js */ `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iData Scan Sync</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f;
       display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh}
  .wrap{background:#fff;border-radius:14px;padding:22px 20px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:min(320px,90vw);text-align:center}
  h1{font-size:17px;margin:0 0 16px}
  h2{font-size:12px;color:#888;text-align:left;margin:0 0 6px;font-weight:600}
  button{width:100%;font-size:14px;padding:11px;border-radius:10px;border:none;background:#0071e3;color:#fff;font-weight:600;cursor:pointer;transition:opacity .15s}
  button:hover{opacity:.9}
  button:active{opacity:.8}
  .divider{margin:12px 0;color:#999;font-size:12px}
  form{display:flex;flex-direction:column;gap:6px}
  input{font-size:14px;padding:11px;border-radius:10px;border:1.5px solid #ccc;text-align:center;text-transform:uppercase;min-width:0}
  input::placeholder{text-transform: none}
  input:focus{border-color:#0071e3;outline:none}
  .join-row{flex-direction:row}
  .join-row input{flex:1}
  .join-row button{width:auto;padding:11px 14px}
  .hint{font-size:10px;color:#999;text-align:left;margin-top:-2px}
  .error{font-size:12px;color:#ff3b30;text-align:left;min-height:14px}
  .video-toggle{margin-top:14px;font-size:12px;color:#0071e3;background:none;border:none;font-weight:600;padding:6px;cursor:pointer;transition:opacity .15s}
  .video-toggle:hover{opacity:.7}
  .video-toggle:active{opacity:.7}
  .video-box{display:none;margin-top:8px}
  .video-box.show{display:block}
  .video-box video{width:100%;border-radius:10px;display:block}
</style>
</head>
<body>
<div class="wrap">
  <h1>iData Scan Sync</h1>

  <h2>Tạo phòng mới</h2>
  <form id="createForm">
    <input id="nameInput" placeholder="Tên phòng (để trống = ngẫu nhiên)" maxlength="20" autocapitalize="characters" autocomplete="off">
    <div class="hint">Chỉ dùng chữ, số hoặc -, từ 1-20 ký tự</div>
    <div class="error" id="createError"></div>
    <button type="submit">Tạo phòng</button>
  </form>

  <div class="divider">hoặc</div>

  <h2>Vào phòng đã có</h2>
  <form id="joinForm" class="join-row">
    <input id="joinInput" placeholder="Mã phòng" maxlength="20" autocapitalize="characters" autocomplete="off">
    <button type="submit">Vào</button>
  </form>
  <div class="error" id="joinError"></div>

  <button type="button" class="video-toggle" id="videoToggle">▾ Hướng dẫn đổi chế độ scan trên iData</button>
  <div class="video-box" id="videoBox">
    <video src="/huong-dan-scan-mode.mp4" controls playsinline preload="none"></video>
  </div>
</div>
<script>
document.getElementById('videoToggle').onclick = () => {
  document.getElementById('videoBox').classList.toggle('show');
};
const errorEl = document.getElementById('createError');

function normalizeRoomId(raw) {
  return raw
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '') // strip Vietnamese diacritics
    .replace(/đ/gi, 'd')
    .trim()
    .toUpperCase()
    .replace(/\\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 20);
}

// Space always ends/commits a Vietnamese IME composition, so replacing it
// live is safe — it can't cut off a diacritic mid-composition the way
// filtering other characters did.
function liveReplaceSpaces(el) {
  el.addEventListener('input', (e) => {
    if (e.isComposing) return;
    if (!el.value.includes(' ')) return;
    const pos = el.selectionStart;
    const before = el.value;
    const after = before.replace(/ +/g, '-');
    el.value = after;
    const diff = before.length - after.length;
    el.setSelectionRange(pos - diff, pos - diff);
  });
}
liveReplaceSpaces(document.getElementById('nameInput'));
liveReplaceSpaces(document.getElementById('joinInput'));

document.getElementById('createForm').onsubmit = async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const name = document.getElementById('nameInput').value.trim();
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.ok) {
    const { roomId } = await res.json();
    location.href = '/r/' + roomId;
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (data.error === 'name_taken') {
    errorEl.textContent = 'Tên phòng này đã được dùng, hãy chọn tên khác.';
  } else if (data.error === 'invalid_name') {
    errorEl.textContent = 'Tên phòng không hợp lệ (chữ, số hoặc -, từ 1-20 ký tự).';
  } else {
    errorEl.textContent = 'Có lỗi xảy ra, thử lại nhé.';
  }
};

const joinErrorEl = document.getElementById('joinError');
document.getElementById('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  joinErrorEl.textContent = '';
  const id = normalizeRoomId(document.getElementById('joinInput').value.trim());
  if (!id) return;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const res = await fetch('/api/rooms/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.exists) {
      location.href = '/r/' + id;
      return;
    } else if (res.ok && !data.exists) {
      joinErrorEl.textContent = 'Không tìm thấy phòng này — kiểm tra lại mã phòng.';
    } else {
      joinErrorEl.textContent = 'Mã phòng không hợp lệ.';
    }
  } catch {
    joinErrorEl.textContent = 'Có lỗi xảy ra, thử lại nhé.';
  }
  btn.disabled = false;
};
</script>
</body>
</html>`;

const ROOM_HTML = /* js */ `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iData Scan Sync</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f}
  header{position:sticky;top:0;background:#1d1d1f;color:#fff;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px}
  header .info{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px}
  header .room-id{font-size:19px;font-weight:700;letter-spacing:2px}
  header .status{font-size:12px;margin-top:2px;display:flex;align-items:center;justify-content:center;gap:5px}
  header .status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#8e8e93;transition:background .2s}
  header .status-dot.connecting{background:#ff9500}
  header .status-dot.connected{background:#34c759}
  header .status-dot.disconnected{background:#ff3b30}
  header .close-btn{background:#ff3b30;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;white-space:nowrap;cursor:pointer;transition:opacity .15s}
  header .close-btn:hover{opacity:.85}
  header .close-btn:active{opacity:.7}
  header .home-btn{background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;white-space:nowrap;text-decoration:none;cursor:pointer;transition:opacity .15s}
  header .home-btn:hover{opacity:.85}
  header .home-btn:active{opacity:.7}
  .scan-box{padding:12px}
  #scanInput{width:100%;box-sizing:border-box;font-size:18px;padding:12px;border-radius:10px;border:2px solid #ccc;text-align:center}
  #scanInput:focus{border-color:#0071e3;outline:none}
  .toolbar{display:flex;gap:6px;padding:0 12px 10px}
  .toolbar button{flex:1;font-size:13px;padding:8px;border-radius:9px;border:1.5px solid #ccc;background:#fff;color:#1d1d1f;font-weight:600;cursor:pointer;transition:opacity .15s,background .15s}
  .toolbar button:hover{background:#f0f0f0}
  .toolbar button:active{opacity:.7}
  .toolbar button.danger{border-color:#ff3b30;color:#ff3b30}
  .count{padding:0 12px 6px;font-size:11px;color:#888;min-height:14px}
  ul#list{list-style:none;margin:0;padding:0 12px 12px}
  .history-toggle{margin:4px 12px 8px;padding:8px 10px;background:#eee;border-radius:9px;font-size:12px;color:#666;display:flex;justify-content:space-between;align-items:center}
  .history-toggle:active{opacity:.7}
  .history-toggle .chev{transition:transform .15s}
  .history-toggle.open .chev{transform:rotate(180deg)}
  ul#historyList{list-style:none;margin:0 12px 12px;padding:0;display:none}
  ul#historyList.show{display:block}
  .history-group{margin-bottom:10px}
  .history-group:last-child{margin-bottom:0}
  .history-group-head{font-size:11px;color:#999;font-weight:600;padding:0 2px 5px;display:flex;align-items:center;gap:8px}
  .history-group-label{overflow-wrap:anywhere}
  .history-copy-btn{flex-shrink:0;background:none;border:none;color:#0071e3;font-size:11px;font-weight:600;padding:3px 4px;cursor:pointer;transition:opacity .15s}
  .history-copy-btn:hover{opacity:.7}
  .history-copy-btn:active{opacity:.6}
  ul.history-group-list{list-style:none;margin:0;padding:0}
  ul.history-group-list li{display:block;background:#f0f0f0;color:#888;border-radius:9px;padding:8px 11px;margin-bottom:5px;font-size:13px;font-weight:500}
  ul.history-group-list li .idx{color:#bbb;font-weight:400;margin-right:6px}
  li{background:#fff;border-radius:9px;padding:9px 11px;margin-bottom:6px;font-weight:600;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,.06);display:flex;align-items:center;justify-content:space-between;gap:8px}
  @keyframes flashHighlight{0%{background:#fff3b0;box-shadow:0 1px 2px rgba(0,0,0,.06),0 0 0 1.5px #ffd60a}100%{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.06)}}
  li.flash{animation:flashHighlight 1.1s ease-out}
  li .idx{color:#aaa;font-weight:400;margin-right:6px;user-select: none}
  li .code-text{flex:1;overflow-wrap:anywhere}
  li .del-btn{background:none;border:none;color:#ff3b30;font-size:17px;line-height:1;padding:3px 6px;flex-shrink:0;user-select: none;cursor:pointer;transition:opacity .15s}
  li .del-btn:hover{opacity:.7}
  li .del-btn:active{opacity:.6}
  li.pending{background:#fff8e1;box-shadow:0 0 0 1.5px #ffcc00 inset}
  .pending-tag{font-size:11px;color:#b58100;font-weight:600;flex-shrink:0}
  .empty{text-align:center;color:#999;padding:18px;font-size:13px}
  .toast{position:fixed;top:calc(var(--header-h, 54px) + 22px);left:50%;transform:translateX(-50%);background:#1d1d1f;color:#fff;padding:6px 14px;border-radius:18px;font-size:12px;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;z-index:20}
  .toast.show{opacity:1}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:20px}
  .overlay.show{display:flex}
  .overlay .card{background:#fff;border-radius:14px;padding:22px;text-align:center;max-width:280px}
  .overlay .card p{margin:0 0 14px;font-size:14px}
  .overlay .card a{display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:600;font-size:14px;cursor:pointer;transition:opacity .15s}
  .overlay .card a:hover{opacity:.9}
  .confirm-actions{display:flex;gap:8px}
  .confirm-actions button{flex:1;border:none;border-radius:9px;padding:10px;font-weight:600;font-size:14px;cursor:pointer;transition:opacity .15s}
  .confirm-actions button:hover{opacity:.85}
  .confirm-actions .cancel-btn{background:#eee;color:#1d1d1f}
  .confirm-actions .ok-btn{background:#ff3b30;color:#fff}
</style>
</head>
<body>
<header>
  <a class="home-btn" href="/">Trang chủ</a>
  <div class="info">
    <div class="room-id" id="roomIdLabel"></div>
    <div class="status" id="wsStatus">
      <span class="status-dot" id="statusDot"></span>
      <span id="statusCount">0 mã</span>
    </div>
  </div>
  <button class="close-btn" id="closeBtn">Đóng phòng</button>
</header>
<div class="scan-box">
  <input id="scanInput" placeholder="Quét mã tại đây" autocomplete="off" autocorrect="off" autocapitalize="characters">
</div>
<div class="toolbar">
  <button id="copyBtn">Copy danh sách</button>
  <button id="clearBtn" class="danger">Xóa danh sách</button>
</div>
<div class="count" id="countLabel"></div>
<ul id="list"></ul>
<div class="history-toggle" id="historyToggle">
  <span>Lịch sử đã xóa (<span id="historyCount">0</span>)</span>
  <span class="chev">▾</span>
</div>
<ul id="historyList"></ul>
<div class="toast" id="toast"></div>
<div class="overlay" id="overlay">
  <div class="card">
    <p>Phòng đã đóng.</p>
    <a href="/">Về trang chủ</a>
  </div>
</div>
<div class="overlay" id="notFoundOverlay">
  <div class="card">
    <p>Không tìm thấy phòng này — có thể đã hết hạn, bị đóng, hoặc mã phòng sai.</p>
    <a href="/">Về trang chủ</a>
  </div>
</div>
<div class="overlay" id="confirmOverlay">
  <div class="card">
    <p id="confirmText"></p>
    <div class="confirm-actions">
      <button class="cancel-btn" id="confirmCancelBtn">Hủy</button>
      <button class="ok-btn" id="confirmOkBtn">Xóa</button>
    </div>
  </div>
</div>

<script>
const roomId = location.pathname.split('/')[2];
document.getElementById('roomIdLabel').textContent = roomId;
document.title = roomId;

const headerEl = document.querySelector('header');
function updateHeaderHeight() {
  document.documentElement.style.setProperty('--header-h', headerEl.offsetHeight + 'px');
}
updateHeaderHeight();
window.addEventListener('resize', updateHeaderHeight);

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
let ws;
let reconnectDelay = 1000;
let reconnectTimer = null;
let hbTimer = null;
let lastRecv = 0;
let closed = false;
let started = false; // set once the room-exists check has passed

// ---- Outbox: scans that the server has not acknowledged yet -----------------
// Persisted in localStorage so they survive a dropped connection, a page reload
// or the browser killing the tab. An item is removed only when the server acks it.
const OUTBOX_KEY = 'iscan-outbox-' + roomId;
const OUTBOX_MAX_AGE = 24 * 60 * 60 * 1000; // same as the room's inactivity TTL
const sentAt = {}; // id -> last send time (memory only)

function loadOutbox() {
  try {
    const a = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    if (!Array.isArray(a)) return [];
    return a.filter((o) => o && o.id && o.code && Date.now() - o.time < OUTBOX_MAX_AGE);
  } catch {
    return [];
  }
}
function saveOutbox() {
  try {
    if (outbox.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // storage full / blocked: still works in memory for this session
  }
}
let outbox = loadOutbox();

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function isOpen() {
  return !!ws && ws.readyState === WebSocket.OPEN;
}
function safeSend(obj) {
  if (!isOpen()) { showToast('Chưa kết nối, thử lại sau'); return false; }
  try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
}
function flushOutbox(force) {
  if (!isOpen()) return;
  const now = Date.now();
  for (const item of outbox) {
    // don't re-send something that was sent a moment ago and is probably still in flight
    if (!force && sentAt[item.id] && now - sentAt[item.id] < 8000) continue;
    try {
      ws.send(JSON.stringify({ type: 'scan', id: item.id, code: item.code, time: item.time }));
      sentAt[item.id] = now;
    } catch {
      return;
    }
  }
}
function removeFromOutbox(id, silent) {
  const before = outbox.length;
  outbox = outbox.filter((o) => o.id !== id);
  delete sentAt[id];
  if (outbox.length !== before) { saveOutbox(); if (!silent) renderAll(); }
}
// Only surface "pending" rows when something is actually wrong (offline, or no ack
// for a while). On a healthy connection the ack comes back in milliseconds and a
// pending row would just flash in and out and make the list jump.
const PENDING_SHOW_DELAY = 1500;
function visiblePending() {
  const now = Date.now();
  return outbox.filter((o) => !isOpen() || now - o.time > PENDING_SHOW_DELAY);
}
function submitScan(code) {
  // Same code already waiting to be sent -> don't queue it twice.
  // While offline, also check the (possibly stale) local list; online, the server decides.
  if (outbox.some((o) => o.code === code) || (!isOpen() && codes.some((c) => c.code === code))) {
    showToast('Trùng đơn: ' + code);
    return;
  }
  outbox.push({ id: newId(), code, time: Date.now() });
  saveOutbox();
  renderAll();
  if (isOpen()) {
    flushOutbox();
    setTimeout(renderAll, PENDING_SHOW_DELAY + 50); // if still unacked by then, show it as pending
  } else {
    showToast('Chưa có mạng - đã lưu tạm, sẽ tự đồng bộ');
  }
}

// ---- Connection + heartbeat ---------------------------------------------------
function connect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (closed || !started) return;
  const sock = new WebSocket(proto + '//' + location.host + '/r/' + roomId + '/ws');
  ws = sock;
  setStatus('connecting');
  // a connection attempt on a dead network can hang for a long time
  setTimeout(() => { if (ws === sock && sock.readyState !== WebSocket.OPEN) dropConnection(); }, 8000);
  sock.onopen = () => {
    if (ws !== sock) return;
    setStatus('connected');
    reconnectDelay = 1000;
    lastRecv = Date.now();
    startHeartbeat();
  };
  sock.onclose = () => { if (ws === sock) dropConnection(); };
  sock.onerror = () => { try { sock.close(); } catch {} };
  sock.onmessage = (event) => {
    if (ws !== sock) return;
    lastRecv = Date.now();
    handleMessage(JSON.parse(event.data));
  };
}
// Socket closed, or it looks dead (a half-open connection still reports OPEN).
function dropConnection() {
  stopHeartbeat();
  const old = ws;
  if (old) {
    old.onopen = old.onclose = old.onerror = old.onmessage = null;
    try { old.close(); } catch {}
  }
  if (closed || !started) return;
  setStatus('disconnected');
  renderAll();
  scheduleReconnect();
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
}
function reconnectNow() {
  if (closed || !started) return;
  if (isOpen() && Date.now() - lastRecv < 12000) return; // looks healthy
  dropConnection();
  reconnectDelay = 1000;
  connect();
}
function startHeartbeat() {
  stopHeartbeat();
  hbTimer = setInterval(() => {
    if (!isOpen()) return;
    // nothing (not even a pong) for 12s -> the link is dead even though readyState says OPEN
    if (Date.now() - lastRecv > 12000) { dropConnection(); return; }
    try { ws.send('{"type":"ping"}'); } catch {}
    flushOutbox(); // retry anything that never got an ack
  }, 5000);
}
function stopHeartbeat() {
  clearInterval(hbTimer);
  hbTimer = null;
}
window.addEventListener('online', reconnectNow);
window.addEventListener('offline', () => dropConnection());
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnectNow(); });
const statusLabels = { connecting: 'Đang kết nối...', connected: 'Đã kết nối', disconnected: 'Mất kết nối, đang thử lại...' };
const statusDotEl = document.getElementById('statusDot');
const statusEl = document.getElementById('wsStatus');
function setStatus(state) {
  statusDotEl.className = 'status-dot ' + state;
  statusEl.title = statusLabels[state] || '';
}
setStatus('connecting');

let codes = [];
let history = [];
let justAddedCode = null;
let justAddedTimer;
const listEl = document.getElementById('list');
const countEl = document.getElementById('countLabel');
const statusCountEl = document.getElementById('statusCount');
const historyListEl = document.getElementById('historyList');
const historyCountEl = document.getElementById('historyCount');
const historyToggleEl = document.getElementById('historyToggle');

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('vi-VN', { hour12: false });
}

function handleMessage(msg) {
  if (msg.type === 'init') {
    codes = msg.codes.slice().reverse(); // newest first
    history = (msg.history || []).slice().reverse(); // newest batch first
    // Anything the server already has (its ack was lost) is no longer pending.
    const known = {};
    msg.codes.forEach((c) => { if (c.id) known[c.id] = true; });
    (msg.history || []).forEach((b) => b.codes.forEach((c) => { if (c.id) known[c.id] = true; }));
    outbox = outbox.filter((o) => !known[o.id]);
    saveOutbox();
    renderAll();
    renderHistory();
    flushOutbox(true); // (re)send everything still unacknowledged
  } else if (msg.type === 'ack') {
    removeFromOutbox(msg.id);
  } else if (msg.type === 'code_added') {
    if (msg.entry.id) removeFromOutbox(msg.entry.id, true); // our own scan: swap pending row for the real one in one render
    codes.unshift(msg.entry);
    justAddedCode = msg.entry.code;
    clearTimeout(justAddedTimer);
    justAddedTimer = setTimeout(() => { justAddedCode = null; }, 1100);
    renderAll();
    showToast(msg.entry.code);
  } else if (msg.type === 'code_duplicate') {
    showToast('Trùng đơn: ' + msg.code);
  } else if (msg.type === 'code_removed') {
    codes = codes.filter((c) => c.code !== msg.code);
    renderAll();
    if (isMobile) focusHiddenKeyboard();
  } else if (msg.type === 'list_cleared') {
    codes = [];
    history = (msg.history || []).slice().reverse();
    renderAll();
    renderHistory();
    showToast('Đã xóa danh sách');
    if (isMobile) focusHiddenKeyboard();
  } else if (msg.type === 'room_closed') {
    closed = true;
    stopHeartbeat();
    outbox = []; // room is gone: pending scans can't be delivered (and must not leak into a future room with the same name)
    saveOutbox();
    renderAll();
    setStatus('disconnected');
    document.getElementById('overlay').classList.add('show');
    document.getElementById('scanInput').disabled = true;
    ws.close();
  }
}

function renderHistory() {
  const totalCount = history.reduce((sum, batch) => sum + batch.codes.length, 0);
  historyCountEl.textContent = totalCount;
  historyListEl.innerHTML = '';
  if (history.length === 0) {
    historyListEl.innerHTML = '<div class="empty">Chưa có danh sách nào bị xóa</div>';
    return;
  }
  history.forEach((batch) => {
    const group = document.createElement('div');
    group.className = 'history-group';
    const head = document.createElement('div');
    head.className = 'history-group-head';
    const label = document.createElement('span');
    label.className = 'history-group-label';
    label.textContent = formatTime(batch.time) + ' · ' + batch.codes.length + ' mã';
    const copyBatchBtn = document.createElement('button');
    copyBatchBtn.type = 'button';
    copyBatchBtn.className = 'history-copy-btn';
    copyBatchBtn.textContent = 'Copy';
    copyBatchBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(batch.codes.map((c) => c.code).join('\\n'));
        showToast('Đã copy ' + batch.codes.length + ' mã');
      } catch {
        showToast('Không copy được, hãy copy thủ công');
      }
      if (isMobile) focusHiddenKeyboard();
    };
    head.appendChild(label);
    head.appendChild(copyBatchBtn);
    group.appendChild(head);
    const ul = document.createElement('ul');
    ul.className = 'history-group-list';
    batch.codes.slice().reverse().forEach((entry, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="idx">' + (i + 1) + '.</span>' + entry.code;
      ul.appendChild(li);
    });
    group.appendChild(ul);
    historyListEl.appendChild(group);
  });
}

historyToggleEl.onclick = () => {
  historyToggleEl.classList.toggle('open');
  historyListEl.classList.toggle('show');
};

function renderAll() {
  const pending = visiblePending();
  statusCountEl.textContent = codes.length + ' mã' + (pending.length ? ' · ' + pending.length + ' chờ gửi' : '');
  countEl.textContent = codes.length ? 'Quét lúc ' + formatTime(codes[0].time) : '';
  updateHeaderHeight();
  if (codes.length === 0 && pending.length === 0) {
    listEl.innerHTML = '<div class="empty">Chưa có mã nào được quét</div>';
    return;
  }
  listEl.innerHTML = '';
  pending.slice().reverse().forEach((item) => {
    const li = document.createElement('li');
    li.className = 'pending';
    const left = document.createElement('span');
    left.className = 'code-text';
    left.textContent = item.code;
    const tag = document.createElement('span');
    tag.className = 'pending-tag';
    tag.textContent = 'Chờ gửi';
    li.appendChild(left);
    li.appendChild(tag);
    listEl.appendChild(li);
  });
  codes.forEach((entry, i) => {
    const code = entry.code;
    const li = document.createElement('li');
    if (code === justAddedCode) li.classList.add('flash');
    const left = document.createElement('span');
    left.className = 'code-text';
    left.innerHTML = '<span class="idx">' + (i + 1) + '.</span>' + code;
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '\\u2715';
    delBtn.onclick = async () => {
      const ok = await showConfirm('Xóa mã ' + code + '?');
      if (ok) {
        safeSend({ type: 'delete_code', code });
      }
      if (isMobile) focusHiddenKeyboard();
    };
    li.appendChild(left);
    li.appendChild(delBtn);
    listEl.appendChild(li);
  });
}

function showConfirm(message) {
  return new Promise((resolve) => {
    document.getElementById('confirmText').textContent = message;
    const overlay = document.getElementById('confirmOverlay');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    overlay.classList.add('show');
    function cleanup(result) {
      overlay.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

let toastTimer;
function showToast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

const input = document.getElementById('scanInput');
const isMobile = window.matchMedia('(pointer: coarse)').matches;

// On mobile: keep the input focused (so an HID/keyboard-emulation scanner
// can type into it) but suppress the on-screen keyboard by default —
// inputmode="none" hides the virtual keyboard while still accepting real
// keystrokes from an external scanner. The keyboard only appears if the
// person deliberately taps the field a second time (i.e. it was already
// focused), for cases where they need to type a code by hand.
let wasFocusedBeforeTap = false;
let suppressBlurHide = false; // true while we're doing our own blur->focus toggle

function focusHiddenKeyboard() {
  if (closed) return;
  if (!isMobile) { input.focus(); return; }
  input.setAttribute('inputmode', 'none');
  input.focus();
}

function focusVisibleKeyboard() {
  if (closed) return;
  input.setAttribute('inputmode', 'text');
  suppressBlurHide = true;
  input.blur();
  setTimeout(() => {
    input.focus();
    suppressBlurHide = false;
  }, 30);
}

if (isMobile) {
  input.addEventListener('pointerdown', () => {
    wasFocusedBeforeTap = document.activeElement === input;
  });
  input.addEventListener('click', () => {
    if (wasFocusedBeforeTap) focusVisibleKeyboard();
  });
  input.addEventListener('blur', () => {
    if (suppressBlurHide) return; // this blur is our own toggle, not a real tap-away
    setTimeout(focusHiddenKeyboard, 200);
  });
  // Any tap elsewhere on the page (including delete/copy/clear buttons)
  // sends focus back to the scan input, keyboard hidden.
  document.addEventListener('click', (e) => {
    if (e.target !== input) focusHiddenKeyboard();
  });
  // Returning to the page (browser back, app switch, tab refocus) — just
  // focus silently, never pop the keyboard open on its own.
  window.addEventListener('pageshow', focusHiddenKeyboard);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) focusHiddenKeyboard();
  });
  input.focus(); // first focus: no inputmode hint, so the scanner's input session is fully established
} else {
  // Desktop/PC: no forced auto-focus, behaves like a normal input.
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const code = input.value.trim();
    if (code) submitScan(code);
    input.value = '';
    if (isMobile) {
      focusHiddenKeyboard(); // back to silent listening mode
      setTimeout(focusHiddenKeyboard, 80); // re-assert in case the IME opened just after
    }
  }
});

document.getElementById('copyBtn').onclick = async () => {
  if (codes.length === 0) { showToast('Danh sách trống'); return; }
  try {
    await navigator.clipboard.writeText(codes.map((c) => c.code).join('\\n'));
    showToast('Đã copy ' + codes.length + ' mã');
  } catch {
    showToast('Không copy được, hãy copy thủ công');
  }
};

document.getElementById('clearBtn').onclick = async () => {
  if (codes.length === 0) return;
  const ok = await showConfirm('Xóa toàn bộ danh sách mã trong phòng?');
  if (ok) {
    safeSend({ type: 'clear_list' });
  }
  if (isMobile) focusHiddenKeyboard();
};

document.getElementById('closeBtn').onclick = async () => {
  const ok = await showConfirm('Đóng phòng này? Mọi thiết bị đang kết nối sẽ bị ngắt.');
  if (ok) {
    safeSend({ type: 'close_room' });
  }
};

renderAll();
renderHistory();

fetch('/api/rooms/check', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: roomId }),
})
  .then((res) => res.json())
  .then((data) => {
    if (data.exists) {
      started = true;
      connect();
    } else {
      closed = true;
      document.getElementById('notFoundOverlay').classList.add('show');
      document.getElementById('scanInput').disabled = true;
    }
  })
  .catch(() => {
    // Network hiccup on the check itself — don't block the user, just try to connect anyway.
    started = true;
    connect();
  });
</script>
</body>
</html>`;
