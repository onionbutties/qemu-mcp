import { z } from 'zod';
import { listMacros, runMacro } from '../macros.mjs';

function textResult(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function errorResult(err) {
  const message = err && err.message ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }] };
}

export function registerMacroTools(server, session) {
  server.registerTool('macro_list', {
    description: 'List available macros.',
    inputSchema: {},
  }, async () => {
    try {
      const names = await listMacros();
      return textResult(names);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('macro_run', {
    description: 'Run a named macro with optional arguments.',
    inputSchema: {
      name: z.string(),
      args: z.record(z.any()).optional(),
    },
  }, async (args = {}) => {
    try {
      const { name, args: macroArgs } = args ?? {};
      const result = await runMacro(name, session, macroArgs ?? {});
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
