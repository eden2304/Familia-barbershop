const net = require('net');
const tls = require('tls');

class Redis {
  constructor(url, _opts = {}) {
    this.url = url;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.connecting = null;
    this.options = { password: undefined };
    if (url) {
      try {
        const u = new URL(url);
        this.options.password = decodeURIComponent(u.password || '') || undefined;
      } catch {}
    }
  }

  _readLine(start) {
    const idx = this.buffer.indexOf('\r\n', start);
    if (idx === -1) return null;
    return { line: this.buffer.toString('utf8', start, idx), next: idx + 2 };
  }

  _parse(offset = 0) {
    if (this.buffer.length <= offset) return null;
    const marker = String.fromCharCode(this.buffer[offset]);
    if (marker === '+' || marker === '-' || marker === ':') {
      const l = this._readLine(offset + 1);
      if (!l) return null;
      if (marker === '+') return { value: l.line, next: l.next };
      if (marker === '-') return { value: new Error(l.line), next: l.next };
      return { value: Number(l.line), next: l.next };
    }
    if (marker === '$') {
      const l = this._readLine(offset + 1);
      if (!l) return null;
      const len = Number(l.line);
      if (len === -1) return { value: null, next: l.next };
      const end = l.next + len;
      if (this.buffer.length < end + 2) return null;
      return { value: this.buffer.toString('utf8', l.next, end), next: end + 2 };
    }
    if (marker === '*') {
      const l = this._readLine(offset + 1);
      if (!l) return null;
      const count = Number(l.line);
      let next = l.next;
      const arr = [];
      for (let i = 0; i < count; i++) {
        const p = this._parse(next);
        if (!p) return null;
        arr.push(p.value);
        next = p.next;
      }
      return { value: arr, next };
    }
    throw new Error('Invalid RESP');
  }

  _flush() {
    while (this.pending.length) {
      const p = this._parse();
      if (!p) break;
      this.buffer = this.buffer.subarray(p.next);
      const job = this.pending.shift();
      if (!job) break;
      if (p.value instanceof Error) job.reject(p.value);
      else job.resolve(p.value);
    }
  }

  _encode(args) {
    const chunks = [Buffer.from(`*${args.length}\r\n`)];
    for (const a of args) {
      const s = String(a);
      chunks.push(Buffer.from(`$${Buffer.byteLength(s)}\r\n${s}\r\n`));
    }
    return Buffer.concat(chunks);
  }

  async _connect() {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      if (!this.url) return reject(new Error('REDIS_URL is missing'));
      let u;
      try { u = new URL(this.url); } catch { return reject(new Error('Invalid REDIS_URL')); }
      const isTls = u.protocol === 'rediss:';
      const host = u.hostname;
      const port = Number(u.port || 6379);
      const db = u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0;
      const username = decodeURIComponent(u.username || '');
      const password = decodeURIComponent(u.password || '');
      const socket = isTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      this.socket = socket;
      socket.on('data', (d) => { this.buffer = Buffer.concat([this.buffer, d]); this._flush(); });
      socket.on('error', (e) => { while (this.pending.length) this.pending.shift().reject(e); });
      socket.on('close', () => { while (this.pending.length) this.pending.shift().reject(new Error('Redis socket closed')); this.socket = null; });
      socket.once('error', reject);
      socket.once('connect', async () => {
        try {
          if (password) {
            if (username) await this.call('AUTH', username, password);
            else await this.call('AUTH', password);
          }
          if (db > 0) await this.call('SELECT', String(db));
          resolve();
        } catch (e) { reject(e); }
      });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async call(...args) {
    await this._connect();
    if (!this.socket || this.socket.destroyed) throw new Error('Redis socket unavailable');
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(this._encode(args), (err) => {
        if (err) {
          const p = this.pending.pop();
          if (p) p.reject(err);
        }
      });
    });
  }

  ping() { return this.call('PING'); }

  async quit() {
    if (!this.socket || this.socket.destroyed) return 'OK';
    try { await this.call('QUIT'); } catch {}
    this.socket.end();
    this.socket.destroy();
    this.socket = null;
    return 'OK';
  }
}

module.exports = Redis;
module.exports.default = Redis;
