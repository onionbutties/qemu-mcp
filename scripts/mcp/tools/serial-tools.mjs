import { z } from 'zod';
import { textResult, errorResult } from './result.mjs';

export function registerSerialTools(server, session) {
  server.registerTool('serial_read', {
    description: 'Read buffered output from the guest serial console. Launch with serial:true to enable it.',
    inputSchema: {
      waitMs: z.number().int().min(0).max(30000).optional(),
    },
  }, async (args = {}) => {
    try {
      const { waitMs } = args ?? {};
      if (typeof session?.serialRead !== 'function') throw new Error('session does not support serial');
      return textResult(await session.serialRead({ waitMs: waitMs ?? 0 }));
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('serial_write', {
    description: 'Write text to the guest serial console.',
    inputSchema: {
      text: z.string().min(1),
    },
  }, async (args = {}) => {
    try {
      const { text } = args ?? {};
      if (typeof session?.serialWrite !== 'function') throw new Error('session does not support serial');
      return textResult(await session.serialWrite(text));
    } catch (err) {
      return errorResult(err);
    }
  });
}
