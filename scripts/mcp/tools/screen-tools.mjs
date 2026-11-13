import { z } from 'zod';
import {
  captureScreen,
  convertToPng,
  readScreenText,
  readScreenAscii,
  screenToImageContent,
  waitForText,
} from '../screen.mjs';

function textResult(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function errorResult(err) {
  const message = err && err.message ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }] };
}

export function registerScreenTools(server, session) {
  server.registerTool('screenshot', {
    description: 'Capture the VM screen and return a PNG image plus its saved path.',
    inputSchema: {},
  }, async () => {
    try {
      const ppm = await captureScreen(session);
      const pngPath = convertToPng(ppm);
      const image = screenToImageContent(pngPath);
      return { content: [{ type: 'text', text: JSON.stringify({ path: pngPath }) }, image] };
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('screen_text', {
    description: 'Capture the VM screen and return OCR text.',
    inputSchema: {},
  }, async () => {
    try {
      const ppm = await captureScreen(session);
      const text = readScreenText(ppm);
      return textResult(text);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('screen_ascii', {
    description: 'Capture the VM screen and return an ASCII rendering.',
    inputSchema: {
      cols: z.number().optional(),
      rows: z.number().optional(),
    },
  }, async (args = {}) => {
    try {
      const { cols, rows } = args ?? {};
      const ppm = await captureScreen(session);
      const ascii = readScreenAscii(ppm, { cols, rows });
      return textResult(ascii);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('wait_for_text', {
    description: 'Poll the VM screen until the given text appears or the timeout expires.',
    inputSchema: {
      pattern: z.string(),
      timeoutMs: z.number().optional(),
      intervalMs: z.number().optional(),
      regex: z.boolean().optional(),
    },
  }, async (args = {}) => {
    try {
      const { pattern, timeoutMs, intervalMs, regex } = args ?? {};
      const result = await waitForText(session, { pattern, timeoutMs, intervalMs, regex });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
