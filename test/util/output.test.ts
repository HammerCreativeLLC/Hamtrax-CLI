import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  color,
  isColorEnabled,
  printJson,
  printKeyValue,
  printNdjson,
  printTable,
  setColorEnabled,
  warn,
} from '../../src/util/output.js';

describe('output helpers', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let writes: string[];
  let errs: string[];

  beforeEach(() => {
    writes = [];
    errs = [];
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as never);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: unknown) => {
        errs.push(String(chunk));
        return true;
      }) as never);
    setColorEnabled(false);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('printJson emits one indented JSON object with trailing newline', () => {
    printJson({ a: 1, b: 'two' });
    expect(writes.join('')).toBe('{\n  "a": 1,\n  "b": "two"\n}\n');
  });

  it('printNdjson emits one line per item', () => {
    printNdjson([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(writes.join('')).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
  });

  it('printTable shows "(no rows)" when empty', () => {
    printTable([], [
      { header: 'id', get: (r) => (r as { id: string }).id },
    ]);
    expect(writes.join('')).toContain('(no rows)');
  });

  it('printTable renders rows with headers', () => {
    printTable(
      [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ],
      [
        { header: 'id', get: (r) => r.id },
        { header: 'name', get: (r) => r.name },
      ],
    );
    const out = writes.join('');
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
  });

  it('printKeyValue aligns keys', () => {
    printKeyValue([
      ['key', 'short'],
      ['longer', 'val'],
    ]);
    const out = writes.join('');
    // 'key   ' (padded to width of 'longer'=6) + two spaces + value
    expect(out).toMatch(/key\s+short/);
    expect(out).toMatch(/longer\s+val/);
  });

  it('warn writes to stderr with prefix', () => {
    warn('something off');
    const out = errs.join('');
    expect(out).toContain('warning:');
    expect(out).toContain('something off');
  });

  it('setColorEnabled toggles isColorEnabled and short-circuits picocolors', () => {
    setColorEnabled(false);
    expect(isColorEnabled()).toBe(false);
    expect(color.green('hello')).toBe('hello');
    setColorEnabled(true);
    expect(isColorEnabled()).toBe(true);
    // picocolors may or may not actually emit ANSI in this env, so just
    // verify the helper passes through (string-typed) without crashing.
    expect(typeof color.green('hello')).toBe('string');
    setColorEnabled(false);
  });

  it('formatCell renders nullish as em-dash', () => {
    printTable(
      [{ id: undefined, name: null }],
      [
        { header: 'id', get: (r) => r.id },
        { header: 'name', get: (r) => r.name },
      ],
    );
    expect(writes.join('')).toContain('—');
  });
});
