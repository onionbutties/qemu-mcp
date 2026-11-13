import { z } from 'zod';

function textResult(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function errorResult(err) {
  const message = err && err.message ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }] };
}

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
    description: 'Launch the QEMU virtual machine.',
    inputSchema: {
      disk: z.string().optional(),
      floppy0: z.string().optional(),
      cd: z.string().optional(),
      shareImg: z.string().optional(),
      stick: z.string().optional(),
      usbHid: z.boolean().optional(),
      boot: z.string().optional(),
      sound: z.boolean().optional(),
      monitorPort: z.number().optional(),
    },
  }, async (args = {}) => {
    try {
      const result = await withLock(session, async () => session.launch(args ?? {}));
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
      const result = await withLock(session, async () => {
        if (typeof session?.monitor === 'function') {
          const mon = await session.monitor();
          if (mon) {
            if (typeof mon.execute === 'function') {
              try {
                await mon.execute('system_reset', {});
                return { ok: true };
              } catch (err) {
                if (typeof mon.cmd !== 'function') throw err;
                // fall through to human monitor command
              }
            }
            if (typeof mon.cmd === 'function') {
              await mon.cmd('system_reset');
              return { ok: true };
            }
            throw new Error('monitor does not support reset');
          }
        }
        if (typeof session?.reset === 'function') {
          return session.reset();
        }
        throw new Error('session does not support reset');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
