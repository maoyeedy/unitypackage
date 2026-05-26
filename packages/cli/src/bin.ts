#!/usr/bin/env node
import { cli } from './cli.js';

cli(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
