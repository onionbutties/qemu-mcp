import { z } from 'zod';
import { createDisk } from '../../lib/qemu.mjs';
import { textResult, errorResult } from './result.mjs';

async function withLock(session, fn) {
  if (typeof session?.withLock === 'function') return session.withLock(fn);
  return fn();
}

export function registerVmTools(server, session) {
  server.registerTool('vm_status', {
    description: 'Report whether the VM is currently running.',
    inputSchema: {},
  }, async () => {
    try {
      const result = await withLock(session, async () => session.status());
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_launch', {
    description: 'Launch the QEMU virtual machine. The disk must already exist.',
    inputSchema: {
      disk: z.string().min(1).optional(),
      diskFormat: z.enum(['qcow2', 'raw', 'vmdk', 'vdi', 'vpc']).optional(),
      floppy0: z.string().min(1).optional(),
      cd: z.string().min(1).optional(),
      shareImg: z.string().min(1).optional(),
      stick: z.string().min(1).optional(),
      usbHid: z.boolean().optional(),
      boot: z.enum(['a', 'c', 'd']).optional(),
      sound: z.boolean().optional(),
      display: z.string().min(1).optional(),
      memoryMb: z.number().int().min(1).max(2048).optional(),
      serial: z.boolean().optional(),
      snapshot: z.boolean().optional(),
      noShutdown: z.boolean().optional(),
      tablet: z.boolean().optional(),
      monitorPort: z.number().int().min(1).max(65535).optional(),
    },
  }, async (args = {}) => {
    try {
      const result = await withLock(session, async () => session.launch(args ?? {}));
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_create_disk', {
    description: 'Create a disk image with qemu-img. Refuses to replace an existing file unless force is true.',
    inputSchema: {
      path: z.string().min(1),
      sizeMb: z.number().int().min(1).max(1024 * 1024),
      format: z.enum(['qcow2', 'raw', 'vmdk', 'vdi', 'vpc']).optional(),
      force: z.boolean().optional(),
    },
  }, async (args = {}) => {
    try {
      const { path: diskPath, sizeMb, format, force } = args ?? {};
      const result = await withLock(session, async () => createDisk(diskPath, sizeMb, format, { force: force === true }));
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_quit', {
    description: 'Shut down the running VM.',
    inputSchema: {},
  }, async () => {
    try {
      const result = await withLock(session, async () => session.quit());
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_info', {
    description: 'Return QMP status, QEMU version, and inserted block devices.',
    inputSchema: {},
  }, async () => {
    try {
      const result = await withLock(session, async () => session.info());
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_pause', {
    description: 'Pause the guest without powering it off.',
    inputSchema: {},
  }, async () => {
    try {
      const result = await withLock(session, async () => session.pause());
      return textResult(result ?? { ok: true });
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_resume', {
    description: 'Resume a paused guest.',
    inputSchema: {},
  }, async () => {
    try {
      const result = await withLock(session, async () => session.resume());
      return textResult(result ?? { ok: true });
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_snapshot', {
    description: 'List, save, load, or delete an internal qcow2 snapshot. Save and load can take a while.',
    inputSchema: {
      action: z.enum(['list', 'save', 'load', 'delete']),
      name: z.string().min(1).optional(),
    },
  }, async (args = {}) => {
    try {
      const { action, name } = args ?? {};
      const result = await withLock(session, async () => session.snapshot(action, name));
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_media', {
    description: 'Insert or eject a CD or floppy image. Use the raw FAT share for data exchange, not this tool.',
    inputSchema: {
      device: z.enum(['cdrom', 'floppy']),
      path: z.string().min(1).optional(),
      eject: z.boolean().optional(),
    },
  }, async (args = {}) => {
    try {
      const { device, path: mediaPath, eject } = args ?? {};
      const result = await withLock(session, async () => session.media(device, { path: mediaPath, eject: eject === true }));
      return textResult(result || { ok: true });
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_log', {
    description: 'Return the last lines of QEMU stdout/stderr. Use this after a failed launch or an unexpected guest stop.',
    inputSchema: {
      lines: z.number().int().min(1).max(500).optional(),
    },
  }, async (args = {}) => {
    try {
      const { lines } = args ?? {};
      const result = await withLock(session, async () => {
        if (typeof session?.log !== 'function') throw new Error('session does not support logs');
        return session.log(lines ?? 50);
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('vm_reset', {
    description: 'Reset the running VM.',
    inputSchema: {},
  }, async () => {
    try {
      if (typeof session?.reset === 'function') {
        return textResult(await session.reset());
      }
      const result = await withLock(session, async () => {
        const mon = typeof session?.monitor === 'function' ? await session.monitor() : null;
        if (!mon) throw new Error('VM not running');
        if (typeof mon.execute === 'function') {
          await mon.execute('system_reset', {});
          return { ok: true };
        }
        if (typeof mon.cmd === 'function') {
          await mon.cmd('system_reset');
          return { ok: true };
        }
        throw new Error('monitor does not support reset');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
