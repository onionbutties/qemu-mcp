import { z } from 'zod';
import { listFatImage, readFatFile, buildFatImage } from '../disk.mjs';

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

export function registerDiskTools(server, session) {
  server.registerTool('fat_list', {
    description: 'List entries in a FAT12/FAT16 image.',
    inputSchema: {
      image: z.string(),
    },
  }, async (args = {}) => {
    try {
      const { image } = args ?? {};
      const result = await withLock(session, async () => listFatImage(image));
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('fat_read', {
    description: 'Read a file from a FAT12/FAT16 image.',
    inputSchema: {
      image: z.string(),
      path: z.string(),
    },
  }, async (args = {}) => {
    try {
      const { image, path: dosPath } = args ?? {};
      const result = await withLock(session, async () => readFatFile(image, dosPath));
      return textResult(result.toString('utf8'));
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('fat_build', {
    description: 'Build a FAT12/FAT16 image from host files.',
    inputSchema: {
      out: z.string(),
      sizeBytes: z.number(),
      label: z.string().optional(),
      partitioned: z.boolean().optional(),
      files: z.array(z.object({
        dosPath: z.string().optional(),
        hostPath: z.string(),
      })),
    },
  }, async (args = {}) => {
    try {
      const { out, sizeBytes, label, partitioned, files } = args ?? {};
      const spec = { sizeBytes, label, partitioned, files };
      const result = await withLock(session, async () => buildFatImage(out, spec));
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
