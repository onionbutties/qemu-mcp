import { z } from 'zod';
import {
  captureScreenPng,
  captureScreenText,
  captureScreenTextWithPath,
  captureScreenAscii,
  captureScreenHash,
  screenToImageContent,
  waitForText,
  waitForIdle,
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
      const pngPath = await captureScreenPng(session);
      const image = screenToImageContent(pngPath);
      return { content: [{ type: 'text', text: JSON.stringify({ path: pngPath }) }, image] };
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('screen_text', {
    description: 'Return guest text. Reads VGA text memory exactly when the guest is in 80x25 text mode, otherwise OCRs the screen. Set savePng to also keep a screenshot for a vision model.',
    inputSchema: {
      mode: z.enum(['auto', 'vga', 'ocr']).optional(),
      crop: cropSchema,
      savePng: z.boolean().optional(),
    },
  }, async (args = {}) => {
    try {
      const { mode, crop, savePng } = args ?? {};
      if (savePng === true) {
        const result = await captureScreenTextWithPath(session, { mode: mode ?? 'auto', crop });
        return textResult(result);
      }
      const text = await captureScreenText(session, { mode: mode ?? 'auto', crop });
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
      const ascii = await captureScreenAscii(session, { cols, rows, crop });
      return textResult(ascii);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('screen_hash', {
    description: 'Return a hash of the current framebuffer. Call it twice to detect a repaint without OCR.',
    inputSchema: {},
  }, async () => {
    try {
      const hash = await captureScreenHash(session);
      return textResult({ hash });
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('wait_for_idle', {
    description: 'Wait until the screen stops changing for stableMs, or time out. Use after a keypress or command.',
    inputSchema: {
      stableMs: z.number().int().min(0).max(60000).optional(),
      timeoutMs: z.number().int().min(0).max(300000).optional(),
      intervalMs: z.number().int().min(50).max(60000).optional(),
    },
  }, async (args = {}) => {
    try {
      const { stableMs, timeoutMs, intervalMs } = args ?? {};
      const result = await waitForIdle(session, { stableMs, timeoutMs, intervalMs });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('wait_for_text', {
    description: 'Poll until text or a regex appears. Reads VGA text exactly in text mode, otherwise OCRs. Prefer this over sleeping.',
    inputSchema: {
      pattern: z.string().min(1).max(200),
      timeoutMs: z.number().int().min(0).max(300000).optional(),
      intervalMs: z.number().int().min(50).max(60000).optional(),
      regex: z.boolean().optional(),
      crop: cropSchema,
      mode: z.enum(['auto', 'vga', 'ocr']).optional(),
    },
  }, async (args = {}) => {
    try {
      const { pattern, timeoutMs, intervalMs, regex, crop, mode } = args ?? {};
      const result = await waitForText(session, { pattern, timeoutMs, intervalMs, regex, crop, mode });
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
