import { z } from 'zod';
import {
  captureScreen,
  convertToPng,
  readScreenText,
  readScreenAscii,
  screenToImageContent,
  waitForText,
} from '../screen.mjs';
import { textResult, errorResult } from './result.mjs';

const cropSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
}).optional();

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
      const text = await readScreenText(ppm);
      return textResult(text);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('screen_ascii', {
    description: 'Capture the VM screen and return an ASCII rendering.',
    inputSchema: {
      cols: z.number().int().min(1).max(2000).optional(),
      rows: z.number().int().min(1).max(2000).optional(),
      crop: cropSchema,
    },
  }, async (args = {}) => {
    try {
      const { cols, rows, crop } = args ?? {};
      const ppm = await captureScreen(session);
      const ascii = readScreenAscii(ppm, { cols, rows, crop });
      return textResult(ascii);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('wait_for_text', {
    description: 'Poll the VM screen until the given text appears or the timeout expires.',
    inputSchema: {
      pattern: z.string().min(1),
      timeoutMs: z.number().int().min(0).max(300000).optional(),
      intervalMs: z.number().int().min(50).max(60000).optional(),
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
