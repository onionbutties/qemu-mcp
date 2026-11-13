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

export function registerMonitorTools(server, session) {
  server.registerTool('monitor_command', {
    description: 'Run a human monitor command.',
    inputSchema: { command: z.string() },
  }, async (args = {}) => {
    try {
      const { command } = args ?? {};
      const result = await withLock(session, async () => {
        const mon = (typeof session?.monitor === 'function') ? await session.monitor() : null;
        if (mon) {
          if (typeof mon.cmd === 'function') return mon.cmd(command);
          if (typeof mon.command === 'function') return mon.command(command);
          throw new Error('monitor does not support commands');
        }
        if (typeof session?.command === 'function') return session.command(command);
        throw new Error('session does not support commands');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('qmp_execute', {
    description: 'Execute a QMP command.',
    inputSchema: {
      command: z.string(),
      arguments: z.record(z.any()).optional(),
    },
  }, async (args = {}) => {
    try {
      const { command, arguments: qmpArgs } = args ?? {};
      const payload = qmpArgs ?? {};
      const result = await withLock(session, async () => {
        const mon = (typeof session?.monitor === 'function') ? await session.monitor() : null;
        if (mon) {
          if (typeof mon.execute === 'function') return mon.execute(command, payload);
          throw new Error('monitor does not support QMP');
        }
        if (typeof session?.qmp === 'function') return session.qmp(command, payload);
        throw new Error('session does not support QMP');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
