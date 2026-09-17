const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // clear room after 24h of no activity

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = [];
    this.codes = null; // array of strings, lazy-loaded from durable storage
    this.history = null; // array of strings previously cleared, lazy-loaded
  }

  async loadCodes() {
    if (this.codes === null) {
      this.codes = (await this.state.storage.get("codes")) || [];
    }
    return this.codes;
  }

  async saveCodes() {
    await this.state.storage.put("codes", this.codes);
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async loadHistory() {
    if (this.history === null) {
      this.history = (await this.state.storage.get("history")) || [];
    }
    return this.history;
  }

  async saveHistory() {
    await this.state.storage.put("history", this.history);
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/claim" && request.method === "POST") {
      const claimed = await this.state.storage.get("claimed");
      if (claimed) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }
      await this.state.storage.put("claimed", true);
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/exists" && request.method === "GET") {
      const claimed = await this.state.storage.get("claimed");
      return new Response(JSON.stringify({ exists: !!claimed }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    await this.loadCodes();
    await this.loadHistory();
    this.sessions.push(server);

    server.send(JSON.stringify({ type: "init", codes: this.codes, history: this.history }));

    server.addEventListener("message", async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "scan" && typeof msg.code === "string") {
        const code = msg.code.trim();
        if (!code) return;
        await this.loadCodes();
        if (this.codes.includes(code)) {
          this.broadcast({ type: "code_duplicate", code });
          return;
        }
        this.codes.push(code);
        this.broadcast({ type: "code_added", code });
        await this.saveCodes();
      }

      if (msg.type === "delete_code" && typeof msg.code === "string") {
        await this.loadCodes();
        const idx = this.codes.indexOf(msg.code);
        if (idx !== -1) {
          this.codes.splice(idx, 1);
          this.broadcast({ type: "code_removed", code: msg.code });
          await this.saveCodes();
        }
      }

      if (msg.type === "clear_list") {
        await this.loadCodes();
        await this.loadHistory();
        if (this.codes.length > 0) {
          this.history = this.history.concat(this.codes);
          this.codes = [];
          this.broadcast({ type: "list_cleared", history: this.history });
          await this.saveCodes();
          await this.saveHistory();
        }
      }

      if (msg.type === "close_room") {
        this.broadcast({ type: "room_closed" });
        for (const s of this.sessions) {
          try {
            s.close(1000, "Room closed");
          } catch {
            // ignore
          }
        }
        this.sessions = [];
        await this.state.storage.deleteAll();
        await this.state.storage.deleteAlarm();
      }
    });

    const cleanup = () => {
      this.sessions = this.sessions.filter((s) => s !== server);
    };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    this.sessions = this.sessions.filter((s) => {
      try {
        s.send(data);
        return true;
      } catch {
        return false;
      }
    });
  }

  async alarm() {
    // Room inactive for ROOM_TTL_MS -> wipe it.
    await this.state.storage.deleteAll();
  }
}
