import { parseArgs as nodeParseArgs } from 'node:util';

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      force: { type: 'boolean' },
      'skip-existing': { type: 'boolean' },
      port: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const [command, ...rest] = positionals as string[];
  return {
    command,
    positional: rest,
    flags: values as Record<string, string | boolean>,
  };
}

export function flagBool(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}

export function flagStr(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}
