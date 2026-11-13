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

async function getMonitor(session) {
  if (typeof session?.monitor === 'function') return session.monitor();
  return null;
}

export function registerInputTools(server, session) {
  server.registerTool('send_key', {
    description: 'Send a key sequence to the VM.',
    inputSchema: { keys: z.string() },
  }, async (args = {}) => {
    try {
      const { keys } = args ?? {};
      const result = await withLock(session, async () => {
        const mon = await getMonitor(session);
        if (mon) {
          if (typeof mon.sendKey === 'function') { await mon.sendKey(keys); return { ok: true }; }
          if (typeof mon.cmd === 'function') { await mon.cmd('sendkey ' + keys); return { ok: true }; }
          throw new Error('monitor does not support sendKey');
        }
        if (typeof session?.sendKey === 'function') { await session.sendKey(keys); return { ok: true }; }
        if (typeof session?.command === 'function') { await session.command('sendkey ' + keys); return { ok: true }; }
        throw new Error('session does not support sendKey');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('type_text', {
    description: 'Type text into the VM.',
    inputSchema: {
      text: z.string(),
      perKeyMs: z.number().optional(),
    },
  }, async (args = {}) => {
    try {
      const { text, perKeyMs } = args ?? {};
      const result = await withLock(session, async () => {
        const mon = await getMonitor(session);
        if (mon) {
          if (typeof mon.type === 'function') { await mon.type(text, perKeyMs ?? 25); return { ok: true }; }
          if (typeof mon.cmd === 'function') {
            // fallback: send each character via sendkey is not trivial; rely on type if present
            throw new Error('monitor does not support type');
          }
          throw new Error('monitor does not support type');
        }
        if (typeof session?.type === 'function') { await session.type(text, perKeyMs ?? 25); return { ok: true }; }
        if (typeof session?.command === 'function') { await session.command('sendkey ' + text); return { ok: true }; }
        throw new Error('session does not support type');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('press', {
    description: 'Press a key sequence, optionally holding it.',
    inputSchema: {
      keys: z.string(),
      holdMs: z.number().optional(),
    },
  }, async (args = {}) => {
    try {
      const { keys, holdMs } = args ?? {};
      const result = await withLock(session, async () => {
        const mon = await getMonitor(session);
        if (mon) {
          if (typeof mon.press === 'function') { await mon.press(keys, holdMs ?? 0); return { ok: true }; }
          if (typeof mon.sendKey === 'function') { await mon.sendKey(holdMs ? `${keys} ${holdMs}` : keys); return { ok: true }; }
          if (typeof mon.cmd === 'function') { await mon.cmd(holdMs ? `sendkey ${keys} ${holdMs}` : `sendkey ${keys}`); return { ok: true }; }
          throw new Error('monitor does not support press');
        }
        if (typeof session?.press === 'function') { await session.press(keys, holdMs ?? 0); return { ok: true }; }
        if (typeof session?.command === 'function') { await session.command(`sendkey ${keys}${holdMs ? ' ' + holdMs : ''}`); return { ok: true }; }
        throw new Error('session does not support press');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('mouse_move', {
    description: 'Move the mouse by a relative delta.',
    inputSchema: {
      dx: z.number(),
      dy: z.number(),
    },
  }, async (args = {}) => {
    try {
      const { dx, dy } = args ?? {};
      const result = await withLock(session, async () => {
        const mon = await getMonitor(session);
        if (mon) {
          if (typeof mon.cmd === 'function') { await mon.cmd(`mouse_move ${dx} ${dy}`); return { ok: true }; }
          throw new Error('monitor does not support mouse_move');
        }
        if (typeof session?.mouseMove === 'function') { await session.mouseMove(dx, dy); return { ok: true }; }
        if (typeof session?.command === 'function') { await session.command(`mouse_move ${dx} ${dy}`); return { ok: true }; }
        throw new Error('session does not support mouse_move');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('mouse_button', {
    description: 'Change mouse button state.',
    inputSchema: {
      button: z.number(),
      down: z.boolean().optional(),
    },
  }, async (args = {}) => {
    try {
      const { button, down } = args ?? {};
      const result = await withLock(session, async () => {
        const mon = await getMonitor(session);
        const state = down === false ? 0 : button;
        if (mon) {
          if (typeof mon.cmd === 'function') { await mon.cmd(`mouse_button ${state}`); return { ok: true }; }
          throw new Error('monitor does not support mouse_button');
        }
        if (typeof session?.mouseButton === 'function') { await session.mouseButton(button, down); return { ok: true }; }
        if (typeof session?.command === 'function') { await session.command(`mouse_button ${state}`); return { ok: true }; }
        throw new Error('session does not support mouse_button');
      });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
