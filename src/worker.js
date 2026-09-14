import { Room } from './room.js';
export { Room };

const ROOM_ID_RE = /^[A-Z0-9]{6}$/;

function randomRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let id = '';
  for (let i = 0; i < 6; i++)
    id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/') {
      return html(LANDING_HTML);
    }

    if (path === '/api/rooms' && request.method === 'POST') {
      const roomId = randomRoomId();
      return new Response(JSON.stringify({ roomId }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const roomPage = path.match(/^\/r\/([A-Za-z0-9]{6})$/);
    if (roomPage && ROOM_ID_RE.test(roomPage[1].toUpperCase())) {
      return html(ROOM_HTML);
    }

    const roomWs = path.match(/^\/r\/([A-Za-z0-9]{6})\/ws$/);
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

const LANDING_HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iData Scan Sync</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f;
       display:flex;align-items:center;justify-content:center;min-height:100vh}
  .wrap{background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:min(360px,90vw);text-align:center}
  h1{font-size:20px;margin:0 0 24px}
  button{width:100%;font-size:17px;padding:14px;border-radius:12px;border:none;background:#0071e3;color:#fff;font-weight:600}
  button:active{opacity:.8}
  .divider{margin:20px 0;color:#999;font-size:13px}
  form{display:flex;gap:8px}
  input{flex:1;font-size:17px;padding:14px;border-radius:12px;border:1.5px solid #ccc;text-align:center;text-transform:uppercase;min-width:0}
  form button{width:auto;padding:14px 16px}
</style>
</head>
<body>
<div class="wrap">
  <h1>iData Scan Sync</h1>
  <button id="createBtn">Tạo phòng mới</button>
  <div class="divider">hoặc</div>
  <form id="joinForm">
    <input id="joinInput" placeholder="Mã phòng" maxlength="6" autocapitalize="characters" autocomplete="off">
    <button type="submit">Vào</button>
  </form>
</div>
<script>
document.getElementById('createBtn').onclick = async () => {
  const res = await fetch('/api/rooms', { method: 'POST' });
  const { roomId } = await res.json();
  location.href = '/r/' + roomId;
};
document.getElementById('joinForm').onsubmit = (e) => {
  e.preventDefault();
  const id = document.getElementById('joinInput').value.trim().toUpperCase();
  if (id.length === 6) location.href = '/r/' + id;
};
</script>
</body>
</html>`;

const ROOM_HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phòng scan</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f}
  header{background:#1d1d1f;color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
  header .info{text-align:center;flex:1}
  header .room-id{font-size:26px;font-weight:700;letter-spacing:4px}
  header .status{font-size:12px;opacity:.7;margin-top:2px}
  header .close-btn{background:#ff3b30;color:#fff;border:none;border-radius:10px;padding:8px 12px;font-size:13px;white-space:nowrap}
  header .close-btn:active{opacity:.7}
  .scan-box{padding:16px}
  #scanInput{width:100%;box-sizing:border-box;font-size:22px;padding:16px;border-radius:12px;border:2px solid #ccc;text-align:center}
  #scanInput:focus{border-color:#0071e3;outline:none}
  .toolbar{display:flex;gap:8px;padding:0 16px 12px}
  .toolbar button{flex:1;font-size:14px;padding:10px;border-radius:10px;border:1.5px solid #ccc;background:#fff;color:#1d1d1f;font-weight:600}
  .toolbar button:active{opacity:.7}
  .toolbar button.danger{border-color:#ff3b30;color:#ff3b30}
  .count{padding:0 16px 8px;font-size:12px;color:#888}
  ul#list{list-style:none;margin:0;padding:0 16px 16px}
  li{background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:8px;font-weight:600;font-size:16px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
  li .idx{color:#aaa;font-weight:400;margin-right:8px}
  .empty{text-align:center;color:#999;padding:24px;font-size:14px}
  .toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#1d1d1f;color:#fff;padding:8px 16px;border-radius:20px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none}
  .toast.show{opacity:1}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:20px}
  .overlay.show{display:flex}
  .overlay .card{background:#fff;border-radius:16px;padding:28px;text-align:center;max-width:320px}
  .overlay .card p{margin:0 0 16px;font-size:15px}
  .overlay .card a{display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600}
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
<div class="toast" id="toast"></div>
<div class="overlay" id="overlay">
  <div class="card">
    <p>Phòng đã đóng.</p>
    <a href="/">Về trang chủ</a>
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
const listEl = document.getElementById('list');
const countEl = document.getElementById('countLabel');

function handleMessage(msg) {
  if (msg.type === 'init') {
    codes = msg.codes.slice();
    renderAll();
  } else if (msg.type === 'code_added') {
    codes.push(msg.code);
    renderAll();
    showToast('Mã mới: ' + msg.code);
  } else if (msg.type === 'list_cleared') {
    codes = [];
    renderAll();
    showToast('Đã xóa danh sách');
  } else if (msg.type === 'room_closed') {
    closed = true;
    document.getElementById('overlay').classList.add('show');
    document.getElementById('scanInput').disabled = true;
    ws.close();
  }
}

function renderAll() {
  countEl.textContent = codes.length + ' mã';
  if (codes.length === 0) {
    listEl.innerHTML = '<div class="empty">Chưa có mã nào được quét</div>';
    return;
  }
  listEl.innerHTML = '';
  codes.forEach((code, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="idx">' + (i + 1) + '.</span>' + code;
    listEl.appendChild(li);
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
function focusInput() { if (!closed) input.focus(); }
input.addEventListener('blur', () => setTimeout(focusInput, 200));
document.addEventListener('click', focusInput);
focusInput();

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const code = input.value.trim();
    if (code && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'scan', code }));
    }
    input.value = '';
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

document.getElementById('clearBtn').onclick = () => {
  if (codes.length === 0) return;
  if (confirm('Xóa toàn bộ danh sách mã trong phòng?')) {
    ws.send(JSON.stringify({ type: 'clear_list' }));
  }
};

document.getElementById('closeBtn').onclick = () => {
  if (confirm('Đóng phòng này? Mọi thiết bị đang kết nối sẽ bị ngắt.')) {
    ws.send(JSON.stringify({ type: 'close_room' }));
  }
};

renderAll();
connect();
</script>
</body>
</html>`;
