/**
 * A tiny glob-expander à la Deno’s `expandGlob`, implemented with Node.js built-ins.
 *
 * Supported patterns:
 *   - `*`   — any chars except `/`                 (one level)
 *   - `**`  — any chars including `/` recursively (many levels)
 *
 * Unsupported (easy to extend in `globToRegExp` if you need):
 *   - `?`, `[]`, `{}` choice groups, extglob, braces, etc.
 *
 * @module
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export interface ExpandGlobOptions {
    /** Base directory for traversal (defaults → `process.cwd()`) */
    cwd?: string;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Very small glob → RegExp converter.
 *  - `**` → `.*`
 *  - `*`  → `[^/]*`
 */
function globToRegExp(glob: string): RegExp {
    const special = /[.+^${}()|[\]\\]/g;          // escape RegExp specials
    return new RegExp('^' +
        glob.replace(/\\/g, '/')                    // win → POSIX slashes
            .replace(special, '\\$&')
            .replace(/\*\*/g, '§§')                 // tmp marker for **
            .replace(/\*/g, '[^/]*')                // *  (1-level)
            .replace(/§§/g, '.*')                   // ** (∞-levels)
        + '$');
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Asynchronous generator that yields every path matching `pattern`.
 *
 * ```ts
 * for await (const p of expandGlob('src/.../.ts')) {
*   console.log(p);
* }
* ```
 *
 * Pattern is treated relative to `opts.cwd` (default `process.cwd()`).
 */
export async function* expandGlob(
  pattern: string,
  opts: ExpandGlobOptions = {},
): AsyncGenerator<string> {
  const cwd   = opts.cwd ?? process.cwd();
  const rex   = globToRegExp(pattern);
  const stack: string[] = [cwd];

  while (stack.length) {
    const dir = stack.pop() as string;
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel  = path.relative(cwd, full).split(path.sep).join('/'); // POSIX

      if (ent.isDirectory()) stack.push(full);
      if (rex.test(rel))     yield full;
    }
  }
}

/** Returns `true` when `filepath` exists **and** is a regular file. */
export async function isFile(filepath: string): Promise<boolean> {
  try {
    return (await fs.stat(filepath)).isFile();
  } catch {
    return false;  // ENOENT, EPERM, ...
  }
}

/**
 * Re-export Node’s `path` so callers may keep using
 *   `import { path } from './fs_glob.ts'`.
 */
export { path };
