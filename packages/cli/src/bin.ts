#!/usr/bin/env node
import { cli } from './cli.js';
import { mapCliError } from './util/exit.js';

cli(process.argv.slice(2)).catch((err: unknown) => {
  const mapped = mapCliError(err);
  console.error(mapped.message);
  process.exit(mapped.code);
});
