import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const extensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export function createLocalObjectStorage(directory) {
  return {
    async put(bytes, contentType) {
      const extension = extensions.get(contentType);
      if (!extension) throw new Error('Unsupported image type.');
      await mkdir(directory, { recursive: true });
      const key = `${randomUUID()}.${extension}`;
      await writeFile(join(directory, key), bytes, { flag: 'wx', mode: 0o600 });
      return key;
    },
    async get(key) {
      if (!/^[a-f\d-]{36}\.(jpg|png|webp)$/.test(key)) return null;
      try {
        return await readFile(join(directory, key));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}

export const allowedImageTypes = new Set(extensions.keys());
