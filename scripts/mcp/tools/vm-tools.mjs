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
    description: 'Create a qcow2 disk image with qemu-img.',
    inputSchema: {
      path: z.string().min(1),
      sizeMb: z.number().int().min(1).max(1024 * 1024),
      format: z.enum(['qcow2', 'raw', 'vmdk', 'vdi', 'vpc']).optional(),
    },
  }, async (args = {}) => {
    try {
      const { path: diskPath, sizeMb, format } = args ?? {};
      const result = await withLock(session, async () => createDisk(diskPath, sizeMb, format));
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
