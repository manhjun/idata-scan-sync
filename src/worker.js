import { Room } from './room.js';
export { Room };

const ROOM_ID_RE = /^[A-Z0-9-]{3,20}$/;

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

    const roomPage = path.match(/^\/r\/([A-Za-z0-9-]{3,20})$/);
    if (roomPage && ROOM_ID_RE.test(roomPage[1].toUpperCase())) {
      return html(ROOM_HTML);
    }

    const roomWs = path.match(/^\/r\/([A-Za-z0-9-]{3,20})\/ws$/);
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
  button{width:100%;font-size:14px;padding:11px;border-radius:10px;border:none;background:#0071e3;color:#fff;font-weight:600}
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
</style>
</head>
<body>
<div class="wrap">
  <h1>iData Scan Sync</h1>

  <h2>Tạo phòng mới</h2>
  <form id="createForm">
    <input id="nameInput" placeholder="Tên phòng (để trống = ngẫu nhiên)" maxlength="20" autocapitalize="characters" autocomplete="off">
    <div class="hint">Chỉ dùng chữ, số hoặc -, từ 3-20 ký tự</div>
    <div class="error" id="createError"></div>
    <button type="submit">Tạo phòng</button>
  </form>

  <div class="divider">hoặc</div>

  <h2>Vào phòng đã có</h2>
  <form id="joinForm" class="join-row">
    <input id="joinInput" placeholder="Mã phòng" maxlength="20" autocapitalize="characters" autocomplete="off">
    <button type="submit">Vào</button>
  </form>
</div>
<script>
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
    errorEl.textContent = 'Tên phòng không hợp lệ (chữ, số, - hoặc _, từ 3-20 ký tự).';
  } else {
    errorEl.textContent = 'Có lỗi xảy ra, thử lại nhé.';
  }
};

document.getElementById('joinForm').onsubmit = (e) => {
  e.preventDefault();
  const id = normalizeRoomId(document.getElementById('joinInput').value.trim());
  if (id) location.href = '/r/' + id;
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
  header .info{display:flex;align-items:center;justify-content:center;gap:10px}
  header .room-id{font-size:19px;font-weight:700;letter-spacing:2px}
  header .status{font-size:11px;opacity:.7;margin-top:1px}
  header .close-btn{background:#ff3b30;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;white-space:nowrap}
  header .close-btn:active{opacity:.7}
  .scan-box{padding:12px}
  #scanInput{width:100%;box-sizing:border-box;font-size:18px;padding:12px;border-radius:10px;border:2px solid #ccc;text-align:center}
  #scanInput:focus{border-color:#0071e3;outline:none}
  .toolbar{display:flex;gap:6px;padding:0 12px 10px}
  .toolbar button{flex:1;font-size:13px;padding:8px;border-radius:9px;border:1.5px solid #ccc;background:#fff;color:#1d1d1f;font-weight:600}
  .toolbar button:active{opacity:.7}
  .toolbar button.danger{border-color:#ff3b30;color:#ff3b30}
  .count{padding:0 12px 6px;font-size:11px;color:#888}
  ul#list{list-style:none;margin:0;padding:0 12px 12px}
  .history-toggle{margin:4px 12px 8px;padding:8px 10px;background:#eee;border-radius:9px;font-size:12px;color:#666;display:flex;justify-content:space-between;align-items:center}
  .history-toggle:active{opacity:.7}
  .history-toggle .chev{transition:transform .15s}
  .history-toggle.open .chev{transform:rotate(180deg)}
  ul#historyList{list-style:none;margin:0 12px 12px;padding:0;display:none}
  ul#historyList.show{display:block}
  ul#historyList li{display:block;background:#f0f0f0;color:#888;border-radius:9px;padding:8px 11px;margin-bottom:5px;font-size:13px;font-weight:500}
  ul#historyList li .idx{color:#bbb;font-weight:400;margin-right:6px}
  li{background:#fff;border-radius:9px;padding:9px 11px;margin-bottom:6px;font-weight:600;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,.06);display:flex;align-items:center;justify-content:space-between;gap:8px}
  li .idx{color:#aaa;font-weight:400;margin-right:6px;user-select: none}
  li .code-text{flex:1;overflow-wrap:anywhere}
  li .del-btn{background:none;border:none;color:#ff3b30;font-size:17px;line-height:1;padding:3px 6px;flex-shrink:0;user-select: none}
  li .del-btn:active{opacity:.6}
  .empty{text-align:center;color:#999;padding:18px;font-size:13px}
  .toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#fff;color:#1d1d1f;padding:6px 14px;border-radius:18px;font-size:12px;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis}
  .toast.show{opacity:1}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:20px}
  .overlay.show{display:flex}
  .overlay .card{background:#fff;border-radius:14px;padding:22px;text-align:center;max-width:280px}
  .overlay .card p{margin:0 0 14px;font-size:14px}
  .overlay .card a{display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:600;font-size:14px}
  .confirm-actions{display:flex;gap:8px}
  .confirm-actions button{flex:1;border:none;border-radius:9px;padding:10px;font-weight:600;font-size:14px}
  .confirm-actions .cancel-btn{background:#eee;color:#1d1d1f}
  .confirm-actions .ok-btn{background:#ff3b30;color:#fff}
</style>
</head>
<body>
<header>
  <div class="info">
    <div class="room-id" id="roomIdLabel"></div>
    <div class="status" id="wsStatus">Đang kết nối...</div>
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

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
let ws;
let reconnectDelay = 1000;
let closed = false;

function connect() {
  ws = new WebSocket(proto + '//' + location.host + '/r/' + roomId + '/ws');
  ws.onopen = () => { setStatus('Đã kết nối'); reconnectDelay = 1000; };
  ws.onclose = () => { if (!closed) { setStatus('Mất kết nối, đang thử lại...'); scheduleReconnect(); } };
  ws.onerror = () => ws.close();
  ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
}
function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
}
function setStatus(text) { document.getElementById('wsStatus').textContent = text; }

let codes = [];
let history = [];
const listEl = document.getElementById('list');
const countEl = document.getElementById('countLabel');
const historyListEl = document.getElementById('historyList');
const historyCountEl = document.getElementById('historyCount');
const historyToggleEl = document.getElementById('historyToggle');

function handleMessage(msg) {
  if (msg.type === 'init') {
    codes = msg.codes.slice().reverse(); // newest first
    history = (msg.history || []).slice().reverse();
    renderAll();
    renderHistory();
  } else if (msg.type === 'code_added') {
    codes.unshift(msg.code);
    renderAll();
    showToast(msg.code);
  } else if (msg.type === 'code_duplicate') {
    showToast('Trùng đơn: ' + msg.code);
  } else if (msg.type === 'code_removed') {
    codes = codes.filter((c) => c !== msg.code);
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
    document.getElementById('overlay').classList.add('show');
    document.getElementById('scanInput').disabled = true;
    ws.close();
  }
}

function renderHistory() {
  historyCountEl.textContent = history.length;
  historyListEl.innerHTML = '';
  history.forEach((code, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="idx">' + (i + 1) + '.</span>' + code;
    historyListEl.appendChild(li);
  });
}

historyToggleEl.onclick = () => {
  historyToggleEl.classList.toggle('open');
  historyListEl.classList.toggle('show');
};

function renderAll() {
  countEl.textContent = codes.length + ' mã';
  if (codes.length === 0) {
    listEl.innerHTML = '<div class="empty">Chưa có mã nào được quét</div>';
    return;
  }
  listEl.innerHTML = '';
  codes.forEach((code, i) => {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.className = 'code-text';
    left.innerHTML = '<span class="idx">' + (i + 1) + '.</span>' + code;
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '\\u2715';
    delBtn.onclick = async () => {
      const ok = await showConfirm('Xóa mã ' + code + '?');
      if (ok) {
        ws.send(JSON.stringify({ type: 'delete_code', code }));
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
    if (code && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'scan', code }));
    }
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
    await navigator.clipboard.writeText(codes.join('\\n'));
    showToast('Đã copy ' + codes.length + ' mã');
  } catch {
    showToast('Không copy được, hãy copy thủ công');
  }
};

document.getElementById('clearBtn').onclick = async () => {
  if (codes.length === 0) return;
  const ok = await showConfirm('Xóa toàn bộ danh sách mã trong phòng?');
  if (ok) {
    ws.send(JSON.stringify({ type: 'clear_list' }));
  }
  if (isMobile) focusHiddenKeyboard();
};

document.getElementById('closeBtn').onclick = async () => {
  const ok = await showConfirm('Đóng phòng này? Mọi thiết bị đang kết nối sẽ bị ngắt.');
  if (ok) {
    ws.send(JSON.stringify({ type: 'close_room' }));
  }
};

renderAll();
renderHistory();
connect();
</script>
</body>
</html>`;
