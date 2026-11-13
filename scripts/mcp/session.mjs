// Stateful wrapper around QEMU launch + QMP monitor.
import fs from 'node:fs';
import { launch, Monitor, MON_PORT } from '../lib/qemu.mjs';
import { machineArgs, DISK } from '../lib/machine.mjs';

export class VmSession {
  constructor(opts = {}) {
    this.launcher = opts.launcher ?? null;
    this.monitorFactory = opts.monitorFactory ?? null;
    this.port = opts.monitorPort ?? MON_PORT;
    this.proc = null;
    this.mon = null;
    this.lastError = null;
    this.disconnected = false;
    this.disk = null;
    this.lock = Promise.resolve();
  }

  status() {
    const running = !!this.mon && !!this.proc && this.proc.exitCode === null && !this.disconnected;
    return {
      running,
      pid: this.proc ? this.proc.pid ?? null : null,
      monitorPort: this.port,
      disk: this.disk,
      lastError: this.lastError,
    };
  }

  isRunning() {
    return !!this.mon && !!this.proc && this.proc.exitCode === null && !this.disconnected;
  }

  async launch(opts = {}) {
    opts = opts ?? {};
    if (this.isRunning()) {
      throw new Error('VM already running');
    }
    const disk = opts.disk || DISK;
    if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) {
      throw new Error(`disk not found: ${disk}. Create it with vm_create_disk or pass a disk path.`);
    }
    this.lastError = null;
    this.disconnected = false;
    const port = (opts && opts.monitorPort != null) ? opts.monitorPort : this.port;
    this.port = port;
    this.disk = disk;

    let result;
    if (this.launcher) {
      result = await this.launcher(opts);
    } else {
      const args = machineArgs(opts);
      const r = await launch(args, { port });
      result = { proc: r.proc, mon: r.mon, port: r.port ?? port, stop: r.stop, log: r.log };
    }

    this.proc = result.proc ?? null;
    if (result.port != null) this.port = result.port;

    try {
      if (result.mon) {
        this.mon = result.mon;
      } else if (this.monitorFactory) {
        this.mon = await this.monitorFactory(port, opts);
      } else {
        this.mon = await Monitor.connect(port);
      }
    } catch (err) {
      const proc = this.proc;
      this.proc = null;
      this.mon = null;
      this.disconnected = false;
      this.lastError = err && err.message ? err.message : String(err);
      if (proc && typeof proc.kill === 'function') {
        try { proc.kill(); } catch {}
      }
      throw err;
    }

    this._attachListeners(this.proc, this.mon);
    return { pid: this.proc ? this.proc.pid ?? null : null, monitorPort: this.port };
  }

  _attachListeners(proc, mon) {
    if (proc && typeof proc.on === 'function') {
      proc.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          this.lastError = `QEMU exited with code ${code}`;
        }
        if (this.proc === proc) {
          this.mon = null;
        }
      });
      proc.on('error', (e) => {
        this.lastError = e && e.message ? e.message : String(e);
        if (this.proc === proc) {
          this.mon = null;
        }
      });
    }
    if (mon && mon.socket && typeof mon.socket.on === 'function') {
      const sock = mon.socket;
      sock.on('close', () => {
        if (this.mon === mon) {
          this.mon = null;
          this.disconnected = true;
          if (!this.lastError) this.lastError = 'monitor disconnected';
        }
      });
      sock.on('error', (e) => {
        if (this.mon === mon) {
          this.lastError = e && e.message ? e.message : String(e);
        }
      });
    }
  }

  async quit() {
    const mon = this.mon;
    const proc = this.proc;
    this.mon = null;
    this.disconnected = true;
    if (mon) {
      try { if (typeof mon.quit === 'function') await mon.quit(); } catch {}
      try { if (typeof mon.close === 'function') mon.close(); } catch {}
    }
    if (proc) {
      try { if (typeof proc.kill === 'function') proc.kill(); } catch {}
    }
    this.proc = null;
    this.lastError = null;
    this.disconnected = false;
    return { ok: true };
  }

  async reset() {
    return this.withLock(async () => {
      const mon = await this.monitor();
      let lastError = null;
      if (mon && typeof mon.execute === 'function') {
        try {
          await mon.execute('system_reset');
          return { ok: true };
        } catch (err) {
          lastError = err;
        }
      }
      if (mon && typeof mon.cmd === 'function') {
        try {
          await mon.cmd('system_reset');
          return { ok: true };
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError ?? new Error('monitor does not support reset');
    });
  }

  async monitor() {
    if (!this.mon || !this.proc || this.proc.exitCode !== null || this.disconnected) {
      throw new Error('VM not running');
    }
    return this.mon;
  }

  async withLock(fn) {
    const result = this.lock.then(() => fn());
    this.lock = result.then(() => undefined, () => undefined);
    return result;
  }

  async command(command) {
    return this.withLock(async () => {
      const mon = await this.monitor();
      if (typeof mon.cmd === 'function') return mon.cmd(command);
      // fallback: treat as QMP-ish? human monitor command
      return mon.execute ? (await mon.execute('human-monitor-command', { 'command-line': command })) : '';
    });
  }

  async qmp(name, args = {}) {
    return this.withLock(async () => {
      const mon = await this.monitor();
      if (typeof mon.execute === 'function') return mon.execute(name, args);
      throw new Error('monitor does not support QMP');
    });
  }
}
