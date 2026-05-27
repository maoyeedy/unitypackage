import { parseArgs as nodeParseArgs } from 'node:util';

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean | string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      force: { type: 'boolean' },
      merge: { type: 'boolean' },
      'skip-existing': { type: 'boolean' },
      'no-meta': { type: 'boolean' },
      'with-meta': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      strict: { type: 'boolean' },
      manifest: { type: 'string' },
      'gzip-level': { type: 'string' },
      filter: { type: 'string' },
      exclude: { type: 'string' },
      path: { type: 'string', multiple: true },
      'path-file': { type: 'string' },
      format: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'max-output-bytes': { type: 'string' },
      'max-entries': { type: 'string' },
      'resolve-deps': { type: 'boolean' },
      'dep-root': { type: 'string' },
      'max-dep-depth': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const [command, ...rest] = positionals;
  return {
    command,
    positional: rest,
    flags: values as Record<string, string | boolean | string[]>,
  };
}

export function flagBool(flags: Record<string, string | boolean | string[]>, name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}

export function flagStr(flags: Record<string, string | boolean | string[]>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}

export function flagStrs(flags: Record<string, string | boolean | string[]>, name: string): string[] {
  const v = flags[name];
  if (Array.isArray(v)) return v;
  return typeof v === 'string' ? [v] : [];
}
