const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // clear room after 24h of no activity

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = [];
    this.codes = null; // array of {code, time}, lazy-loaded from durable storage
    this.history = null; // array of {time, codes: [{code, time}]} batches, lazy-loaded
  }

  async loadCodes() {
    if (this.codes === null) {
      const raw = (await this.state.storage.get("codes")) || [];
      // Legacy rooms stored plain strings before scan timestamps were added.
      this.codes = raw.map((item) => (typeof item === "string" ? { code: item, time: 0 } : item));
    }
    return this.codes;
  }

  async saveCodes() {
    await this.state.storage.put("codes", this.codes);
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async loadHistory() {
    if (this.history === null) {
      const raw = (await this.state.storage.get("history")) || [];
      if (raw.length > 0 && typeof raw[0] === "string") {
        // Legacy rooms stored a single flat array of code strings.
        this.history = [{ time: 0, codes: raw.map((code) => ({ code, time: 0 })) }];
      } else {
        // Already batched; normalize any legacy string entries inside each batch.
        this.history = raw.map((batch) => ({
          time: batch.time || 0,
          codes: (batch.codes || []).map((item) =>
            typeof item === "string" ? { code: item, time: 0 } : item
          ),
        }));
      }
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
        if (this.codes.some((c) => c.code === code)) {
          this.broadcast({ type: "code_duplicate", code });
          return;
        }
        const entry = { code, time: Date.now() };
        this.codes.push(entry);
        this.broadcast({ type: "code_added", entry });
        await this.saveCodes();
      }

      if (msg.type === "delete_code" && typeof msg.code === "string") {
        await this.loadCodes();
        const idx = this.codes.findIndex((c) => c.code === msg.code);
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
          const batch = {
            time: this.codes[this.codes.length - 1].time, // scan time of the last code in this batch
            codes: this.codes,
          };
          this.history.push(batch);
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
        // Reset in-memory caches too — otherwise this Durable Object instance
        // could keep serving the stale pre-close data (from loadCodes/loadHistory's
        // "already loaded" check) to any request that reaches it before Cloudflare
        // evicts it from memory.
        this.codes = [];
        this.history = [];
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
