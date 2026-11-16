// Stateful wrapper around QEMU launch + QMP monitor.
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { launch, Monitor, MON_PORT, freePort } from '../lib/qemu.mjs';
import { machineArgs, DISK } from '../lib/machine.mjs';
import { SerialConsole } from './serial.mjs';
import { captureScreenSize } from './screen.mjs';
import { absoluteAxis, MOUSE_BUTTONS } from './pointer.mjs';

// Marks the async context that already holds the lock so nested calls do not
// queue behind themselves forever.
const lockContext = new AsyncLocalStorage();

// Names QEMU gives the default removable devices created by machineArgs().
const MEDIA_DEVICES = {
  cdrom: 'ide1-cd0',
  floppy: 'floppy0',
};

export class VmSession {
  constructor(opts = {}) {
    this.launcher = opts.launcher ?? null;
    this.monitorFactory = opts.monitorFactory ?? null;
    this.pinnedPort = opts.monitorPort ?? MON_PORT ?? null;
    this.port = this.pinnedPort;
    this.proc = null;
    this.mon = null;
    this.lastError = null;
    this.disconnected = false;
    this.disk = null;
    this.lock = Promise.resolve();
    this.logTail = null;
    this.serialPort = null;
    this.serialConn = null;
    this.serialPromise = null;
    this.serialFactory = opts.serialFactory ?? SerialConsole.connect;
    this.serialGen = 0;
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
    // A live QEMU with a dead monitor is invisible to isRunning(); launching a
    // second one would open the same disk twice.
    if (this.proc && this.proc.exitCode === null) {
      throw new Error(`QEMU is still running (pid ${this.proc.pid ?? 'unknown'}); quit it before launching another VM`);
    }
    if (this.isRunning()) {
      throw new Error('VM already running');
    }
    const disk = path.resolve(opts.disk || DISK);
    if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) {
      throw new Error(`disk not found: ${disk}. Create it with vm_create_disk or pass a disk path.`);
    }
    this.lastError = null;
    this.disconnected = false;
    this.logTail = null;
    const port = opts.monitorPort ?? this.pinnedPort ?? null;
    this.port = port;
    this.disk = disk;

    // QEMU runs with cwd=ROOT, so every user-supplied media path has to be
    // absolute; otherwise the existence check above and QEMU look in
    // different directories.
    const resolved = { ...opts, disk };
    for (const key of ['floppy0', 'cd', 'shareImg', 'stick']) {
      if (resolved[key]) resolved[key] = path.resolve(resolved[key]);
    }

    if (this.serialConn) {
      try { this.serialConn.close(); } catch {}
    }
    this.serialConn = null;
    this.serialPromise = null;
    this.serialPort = null;
    this.serialGen++;

    if (resolved.serial === true) {
      const serialPort = await freePort();
      this.serialPort = serialPort;
      resolved.serial = `tcp:127.0.0.1:${serialPort},server=on,wait=off`;
    } else if (typeof resolved.serial === 'string' && resolved.serial !== 'none') {
      const match = /tcp:127\.0\.0\.1:(\d+)/.exec(resolved.serial);
      if (match) this.serialPort = Number(match[1]);
    }

    let result;
    if (this.launcher) {
      result = await this.launcher(resolved);
    } else {
      const args = machineArgs(resolved);
      const r = await launch(args, { port, display: resolved.display });
      result = { proc: r.proc, mon: r.mon, port: r.port ?? port, stop: r.stop, log: r.log, tail: r.tail };
    }

    this.proc = result.proc ?? null;
    if (result.port != null) this.port = result.port;
    if (typeof result.tail === 'function') this.logTail = result.tail;

    try {
      if (result.mon) {
        this.mon = result.mon;
      } else if (this.monitorFactory) {
        this.mon = await this.monitorFactory(this.port, opts);
      } else {
        this.mon = await Monitor.connect(this.port);
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
    if (this.serialConn) {
      try { this.serialConn.close(); } catch {}
      this.serialConn = null;
    }
    this.serialPromise = null;
    this.serialPort = null;
    this.serialGen++;
    this.proc = null;
    this.lastError = null;
    this.disconnected = false;
    this.port = this.pinnedPort;
    return { ok: true };
  }

  /** Last lines of QEMU output; available after the process has gone. */
  log(lines = 50) {
    if (typeof this.logTail !== 'function') return '';
    return this.logTail(lines).join('\n');
  }

  /** Recent QMP events, oldest first. */
  async events(limit = 50) {
    const mon = await this.monitor();
    return Array.isArray(mon.eventLog) ? mon.eventLog.slice(-limit) : [];
  }

  /** QMP status, version, and a compact block-device list. */
  async info() {
    return this.withLock(async () => {
      const mon = await this.monitor();
      const [status, version, blocks] = await Promise.all([
        mon.execute('query-status'),
        mon.execute('query-version'),
        mon.execute('query-block'),
      ]);
      return {
        status,
        version,
        block: (blocks ?? []).map((b) => ({
          device: b.device,
          inserted: !!b.inserted,
          file: b.inserted?.file ?? null,
          readOnly: b.inserted?.ro ?? null,
          driver: b.inserted?.drv ?? null,
        })),
      };
    });
  }

  async pause() {
    return this.qmp('stop');
  }

  async resume() {
    return this.qmp('cont');
  }

  async snapshot(action, name) {
    return this.withLock(async () => {
      const mon = await this.monitor();
      if (action === 'list') return mon.cmdChecked('info snapshots');
      if (!name) throw new Error('snapshot name required');
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`invalid snapshot name: ${name}`);
      if (action === 'save') return mon.cmdChecked(`savevm ${name}`, 120000);
      if (action === 'load') return mon.cmdChecked(`loadvm ${name}`, 120000);
      if (action === 'delete') return mon.cmdChecked(`delvm ${name}`);
      throw new Error(`unknown snapshot action: ${action}`);
    });
  }

  /** Insert or eject CD or floppy media. */
  async media(device, { path: mediaPath = null, eject = false } = {}) {
    const target = MEDIA_DEVICES[device];
    if (!target) throw new Error(`unknown media device: ${device}; use cdrom or floppy`);
    const mon = await this.monitor();
    if (eject) return mon.execute('eject', { device: target, force: true });
    if (!mediaPath) throw new Error('path is required unless eject is true');
    const file = path.resolve(mediaPath);
    if (!fs.existsSync(file)) throw new Error(`media not found: ${file}`);
    // QMP takes the filename as a JSON string, so spaces and backslashes work.
    // Let QEMU probe the format so qcow2 CD/floppy images keep working.
    return mon.execute('blockdev-change-medium', { device: target, filename: file });
  }

  async serial() {
    if (!this.serialPort) throw new Error('serial console is disabled; launch with serial:true');
    if (this.serialConn && !this.serialConn.closed) return this.serialConn;
    if (!this.serialPromise) {
      const gen = this.serialGen;
      const port = this.serialPort;
      const pending = Promise.resolve()
        .then(() => this.serialFactory(port))
        .then((con) => {
          if (gen !== this.serialGen) {
            // A quit or relaunch happened while connecting; never adopt or
            // expose a socket pointed at the previous port.
            try { con.close(); } catch {}
            throw new Error('serial connection superseded by a new launch');
          }
          this.serialConn = con;
          return con;
        })
        .finally(() => {
          if (this.serialPromise === pending) this.serialPromise = null;
        });
      this.serialPromise = pending;
    }
    return this.serialPromise;
  }

  async serialRead({ waitMs = 0 } = {}) {
    const con = await this.serial();
    if (waitMs > 0 && con.buffer.length === 0) await con.waitForData(waitMs);
    return con.read().toString('utf8');
  }

  async serialWrite(text) {
    const con = await this.serial();
    con.write(text);
    return { ok: true, bytes: Buffer.byteLength(String(text), 'utf8') };
  }

  /** Click at absolute screen pixels using the USB tablet. */
  async clickAt(x, y, { button = 'left' } = {}) {
    if (!MOUSE_BUTTONS.has(button)) throw new Error(`unknown mouse button: ${button}`);
    const size = await captureScreenSize(this);
    if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
      throw new Error(`click (${x},${y}) is outside ${size.width}x${size.height}`);
    }
    const events = [
      { type: 'abs', data: { axis: 'x', value: absoluteAxis(x, size.width) } },
      { type: 'abs', data: { axis: 'y', value: absoluteAxis(y, size.height) } },
      { type: 'btn', data: { down: true, button } },
      { type: 'btn', data: { down: false, button } },
    ];
    try {
      return await this.qmp('input-send-event', { events });
    } catch (err) {
      throw new Error(`${err.message}. Absolute clicks need the USB tablet; launch with tablet:true and a guest driver.`);
    }
  }

  /** Synchronous last-resort cleanup for process exit handlers. */
  killChild() {
    const mon = this.mon;
    const proc = this.proc;
    this.mon = null;
    this.proc = null;
    this.disconnected = true;
    if (mon && typeof mon.close === 'function') {
      try { mon.close(); } catch {}
    }
    if (this.serialConn) {
      try { this.serialConn.close(); } catch {}
      this.serialConn = null;
    }
    this.serialPromise = null;
    this.serialPort = null;
    this.serialGen++;
    if (proc && typeof proc.kill === 'function') {
      try { proc.kill(); } catch {}
    }
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
    if (lockContext.getStore() === this) return fn();
    const result = this.lock.then(() => lockContext.run(this, fn));
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
