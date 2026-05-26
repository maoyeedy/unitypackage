#!/usr/bin/env node
import { cli } from './cli.js';
import { mapCliError } from './util/exit.js';

const argv = process.argv.slice(2);

cli(argv).catch((err: unknown) => {
  const mapped = mapCliError(err);
  if (argv.includes('--json')) {
    process.stderr.write(JSON.stringify({ level: 'error', message: mapped.message }) + '\n');
  } else {
    console.error(mapped.message);
  }
  process.exit(mapped.code);
});
