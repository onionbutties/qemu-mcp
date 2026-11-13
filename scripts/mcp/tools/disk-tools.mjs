import { z } from 'zod';
import { listFatImage, readFatFile, buildFatImage } from '../disk.mjs';
import { textResult, errorResult } from './result.mjs';

async function withLock(session, fn) {
  if (typeof session?.withLock === 'function') return session.withLock(fn);
  return fn();
}

export function registerDiskTools(server, session) {
  server.registerTool('fat_list', {
    description: 'List entries in a FAT12/FAT16 image.',
    inputSchema: {
      image: z.string().min(1),
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
    description: 'Read a file from a FAT12/FAT16 image. Use encoding=base64 for binary files.',
    inputSchema: {
      image: z.string().min(1),
      path: z.string().min(1),
      encoding: z.enum(['utf8', 'base64']).optional(),
    },
  }, async (args = {}) => {
    try {
      const { image, path: dosPath, encoding } = args ?? {};
      const buf = await withLock(session, async () => readFatFile(image, dosPath));
      return textResult(encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8'));
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool('fat_build', {
    description: 'Build a FAT16 image from host files.',
    inputSchema: {
      out: z.string().min(1),
      sizeBytes: z.number().int().min(4096),
      label: z.string().min(1).optional(),
      partitioned: z.boolean().optional(),
      files: z.array(z.object({
        dosPath: z.string().min(1).optional(),
        hostPath: z.string().min(1),
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
