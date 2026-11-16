// QEMU process launcher and human-monitor client.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textToKeys } from './keys.mjs';
import { createLogBuffer } from './logbuffer.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function defaultQemuBin() {
  if (process.env.QEMU_BIN) return process.env.QEMU_BIN;
  if (process.platform === 'win32') return 'C:\\Program Files\\qemu\\qemu-system-i386.exe';
  return 'qemu-system-i386';
}

export const QEMU = defaultQemuBin();
export const QEMU_IMG = process.env.QEMU_IMG || path.join(
  path.dirname(QEMU),
  process.platform === 'win32' ? 'qemu-img.exe' : 'qemu-img',
);
// A fixed port makes two sessions collide and lets a new launch attach to a
// stale QEMU that still owns the port. Default to a free port per launch;
// QEMU_MONITOR_PORT pins the old behaviour when a client needs it.
export const MON_PORT = Number(process.env.QEMU_MONITOR_PORT) || null;
// screendump reads the guest console surface, not the host window, so a
// headless display is enough for the control loop on platforms without GTK.
export const DEFAULT_DISPLAY = process.env.QEMU_DISPLAY
  || (process.platform === 'win32' ? 'gtk' : 'none');

export const P = (...parts) => path.join(ROOT, ...parts);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until a TCP port accepts connections. */
export async function waitPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise((resolve) => {
      const s = net.connect({ port, host: '127.0.0.1' });
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
      setTimeout(() => { s.destroy(); resolve(false); }, 500);
    });
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`monitor port ${port} never opened`);
    await sleep(150);
  }
}

/** Reserve a free localhost TCP port by binding it, then releasing it. */
// Ports handed out recently are not offered again, so a monitor port and a
// serial port in the same launch cannot collide.
const recentPorts = new Set();

export async function freePort() {
  for (let attempt = 0; attempt < 32; attempt++) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    if (recentPorts.has(port)) continue;
    recentPorts.add(port);
    if (recentPorts.size > 64) recentPorts.delete(recentPorts.values().next().value);
    return port;
  }
  throw new Error('could not find a free localhost port');
}

export class Monitor {
  static MAX_EVENTS = 200;

  constructor(socket) {
    this.socket = socket;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = {};
    this.eventLog = [];
    socket.setEncoding('utf8');
    socket.on('data', (d) => {
      this.buf += d;
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject, timer } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.error) reject(new Error(`${msg.error.class}: ${msg.error.desc}`));
          else resolve(msg.return);
        } else if (msg.event) {
          if (this.eventLog.length >= Monitor.MAX_EVENTS) this.eventLog.shift();
          this.eventLog.push({
            name: msg.event,
            timestamp: msg.timestamp ?? null,
            data: msg.data ?? null,
          });
          (this.handlers[msg.event] ?? (() => {}))(msg);
        }
      }
    });
    socket.on('error', (e) => {
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(e); }
      this.pending.clear();
    });
    // A clean close (QEMU exited) must reject in-flight commands too, or the
    // caller waits for the full command timeout.
    socket.on('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('monitor closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(port = MON_PORT, timeoutMs = 15000) {
    if (port == null) throw new Error('no monitor port');
    // QEMU's socket chardev accepts a single connection, so retry the real
    // connection instead of probing the port with a throwaway socket.
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const socket = await new Promise((resolve, reject) => {
          const s = net.connect({ port, host: '127.0.0.1' }, () => resolve(s));
          s.once('error', reject);
        });
        const mon = new Monitor(socket);
        await mon.execute('qmp_capabilities');
        return mon;
      } catch (e) {
        lastError = e;
        await sleep(150);
      }
    }
    throw lastError ?? new Error('monitor never opened');
  }

  /** Send a QMP command by name. */
  execute(name, args = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${name}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ execute: name, arguments: args, id }) + '\n');
    });
  }

  /** Run a human-monitor-command and return its text output. */
  async cmd(command, timeoutMs = 20000) {
    const out = await this.execute('human-monitor-command', { 'command-line': command }, timeoutMs);
    return String(out ?? '');
  }

  /** HMP reports failures as text; turn "Error: ..." into a rejection. */
  async cmdChecked(command, timeoutMs = 20000) {
    const out = await this.cmd(command, timeoutMs);
    if (/^\s*error:/i.test(out)) throw new Error(out.trim());
    return out;
  }

  async sendKey(keys) {
    await this.cmd('sendkey ' + keys, 8000);
  }

  /** Type text at the current focus, one key at a time. */
  async type(text, perKeyMs = 25) {
    // Map the whole string first so an unmappable character fails before any
    // key is sent; a half-typed command is worse than a rejected one.
    const keys = textToKeys(text);
    for (const k of keys) {
      await this.sendKey(k);
      if (perKeyMs) await sleep(perKeyMs);
    }
  }

  /** Press a key sequence such as "ret" or "alt-f4" with a hold time. */
  async press(keys, holdMs = 0) {
    await this.sendKey(holdMs ? `${keys} ${holdMs}` : keys);
  }

  /** Write a PNG screenshot and return its path. */
  async screendump(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.unlinkSync(file); } catch {}
    await this.cmd('screendump ' + file, 20000);
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
      await sleep(100);
    }
    throw new Error('screendump produced no file: ' + file);
  }

  async change(device, file) {
    return this.cmd(`change ${device} ${file}`);
  }

  async quit() {
    try { await this.cmd('quit', 3000); } catch {}
    this.socket.destroy();
  }

  close() { this.socket.destroy(); }
}

/**
 * Launch QEMU with the given argument list and attach to its monitor.
 * Returns { proc, mon, log } where log() returns accumulated stderr.
 */
export async function launch(args, {
  monitor = true,
  port = MON_PORT,
  logFile = null,
  display = DEFAULT_DISPLAY,
} = {}) {
  const listenPort = port ?? await freePort();
  const full = [
    QEMU,
    '-qmp', `tcp:127.0.0.1:${listenPort},server,nowait`,
    ...(display ? ['-display', display] : []),
    ...args,
  ];
  const proc = spawn(full[0], full.slice(1), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = createLogBuffer();
  proc.stderr.setEncoding('latin1');
  proc.stdout.setEncoding('latin1');
  proc.stderr.on('data', (d) => logs.push(d));
  proc.stdout.on('data', (d) => logs.push(d));
  if (logFile) {
    const stream = fs.createWriteStream(logFile, { flags: 'a' });
    proc.stderr.on('data', (d) => stream.write(d));
    proc.stdout.on('data', (d) => stream.write(d));
  }
  proc.on('exit', (code) => { if (code !== 0) logs.push(`\n[exited with code ${code}]`); });

  // A missing or non-executable QEMU emits 'error'. Without a listener Node
  // treats it as an unhandled event and kills the MCP server, so wait for the
  // spawn result and turn it into a normal tool error.
  try {
    await new Promise((resolve, reject) => {
      proc.once('spawn', resolve);
      proc.once('error', reject);
    });
  } catch (err) {
    throw new Error(`QEMU did not start (${QEMU}): ${err && err.message ? err.message : err}`);
  }
  // Keep a listener for late errors so they cannot become unhandled events.
  proc.on('error', (err) => { logs.push(`\n[spawn error: ${err && err.message ? err.message : err}]`); });

  let mon = null;
  if (monitor) {
    try {
      // Fail fast when QEMU exits on bad arguments instead of waiting out the
      // monitor connect timeout.
      mon = await Promise.race([
        Monitor.connect(listenPort),
        new Promise((_, reject) => {
          proc.once('exit', (code) => reject(new Error(`QEMU exited with code ${code}`)));
        }),
      ]);
    } catch (e) {
      proc.kill();
      throw new Error(`QEMU did not start: ${e.message}\n${logs.text()}`);
    }
    await sleep(300);
  }
  return {
    proc, mon, port: listenPort,
    args: full.slice(1),
    log: () => logs.text(),
    tail: (n = 50) => logs.lines(n),
    async stop() { if (mon) await mon.quit(); proc.kill(); await sleep(400); },
  };
}

/** Create a qcow2 disk synchronously and return its path. */
export function createDisk(file, sizeMb, format = 'qcow2', { force = false } = {}) {
  if (!Number.isFinite(sizeMb) || sizeMb <= 0) throw new Error('sizeMb must be a positive number');
  const target = path.resolve(file);
  if (!force && fs.existsSync(target)) {
    throw new Error(`disk already exists: ${target}. Pass force:true to replace it.`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const r = spawnSync(QEMU_IMG, ['create', '-f', format, target, `${sizeMb}M`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    throw new Error(`qemu-img create failed: ${(r.stderr || r.stdout || '').trim() || `exit ${r.status}`}`);
  }
  return { path: target, sizeMb, format };
}

/** Create a qcow2 disk if it does not exist yet. */
export function ensureDisk(file, sizeMb) {
  if (fs.existsSync(file)) return false;
  createDisk(file, sizeMb);
  return true;
}
