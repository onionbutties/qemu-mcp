// QEMU process launcher and human-monitor client.
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textToKeys } from './keys.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const QEMU = 'C:\\Program Files\\qemu\\qemu-system-i386.exe';
export const MON_PORT = 5555;

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

export class Monitor {
  constructor(socket) {
    this.socket = socket;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    socket.setEncoding('latin1');
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
          (this.events?.[msg.event] ?? (() => {}))(msg);
        }
      }
    });
    socket.on('error', (e) => {
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(e); }
      this.pending.clear();
    });
  }

  static async connect(port = MON_PORT, timeoutMs = 15000) {
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

  async sendKey(keys) {
    await this.cmd('sendkey ' + keys, 8000);
  }

  /** Type text at the current focus, one key at a time. */
  async type(text, perKeyMs = 25) {
    for (const k of textToKeys(text)) {
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
export async function launch(args, { monitor = true, port = MON_PORT, logFile = null } = {}) {
  const full = [QEMU, '-qmp', `tcp:127.0.0.1:${port},server,nowait`, '-display', 'gtk', ...args];
  const proc = spawn(full[0], full.slice(1), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let stdout = '';
  proc.stderr.setEncoding('latin1');
  proc.stdout.setEncoding('latin1');
  proc.stderr.on('data', (d) => { stderr += d; });
  proc.stdout.on('data', (d) => { stdout += d; });
  if (logFile) {
    const stream = fs.createWriteStream(logFile, { flags: 'a' });
    proc.stderr.on('data', (d) => stream.write(d));
    proc.stdout.on('data', (d) => stream.write(d));
  }
  proc.on('exit', (code) => { if (code !== 0) stderr += `\n[exited with code ${code}]`; });
  let mon = null;
  if (monitor) {
    try { mon = await Monitor.connect(port); }
    catch (e) { proc.kill(); throw new Error(`QEMU did not start: ${e.message}\n${stderr}`); }
    await sleep(300);
  }
  return {
    proc, mon,
    args: full.slice(1),
    log: () => stderr + stdout,
    async stop() { if (mon) await mon.quit(); proc.kill(); await sleep(400); },
  };
}

/** Create a qcow2 disk if it does not exist yet. */
export function ensureDisk(file, sizeMb) {
  if (fs.existsSync(file)) return false;
  const r = spawn(QEMU.replace(/qemu-system-i386\.exe$/, 'qemu-img.exe'),
    ['create', '-f', 'qcow2', file, `${sizeMb}M`], { stdio: 'inherit' });
  return r;
}
