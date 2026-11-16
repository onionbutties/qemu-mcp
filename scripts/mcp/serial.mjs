// Bidirectional serial console over QEMU's -serial tcp chardev.
import net from 'node:net';

const MAX_BUFFER = 256 * 1024;

export class SerialConsole {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    socket.on('data', (d) => {
      const chunk = Buffer.isBuffer(d) ? d : Buffer.from(d);
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > MAX_BUFFER) {
        this.buffer = this.buffer.subarray(this.buffer.length - MAX_BUFFER);
      }
    });
    socket.on('close', () => { this.closed = true; });
    socket.on('error', () => { this.closed = true; });
  }

  static connect(port, { host = '127.0.0.1', timeoutMs = 5000 } = {}) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ port, host });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`serial console did not open on port ${port}`));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(new SerialConsole(socket));
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Wait up to ms for any data; resolves true when something arrived. */
  waitForData(ms) {
    if (this.buffer.length > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer);
        this.socket.off('data', onData);
        resolve(value);
      };
      const onData = () => done(true);
      const timer = setTimeout(() => done(false), Math.max(1, ms));
      this.socket.on('data', onData);
    });
  }

  read() {
    const out = this.buffer;
    this.buffer = Buffer.alloc(0);
    return out;
  }

  write(data) {
    this.socket.write(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'));
  }

  close() {
    this.closed = true;
    this.socket.destroy();
  }
}
