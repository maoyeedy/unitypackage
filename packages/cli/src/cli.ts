import path from 'node:path';
import type { ParseUnityPackageOptions } from 'unitypackage-core';
import { extract } from './commands/extract.js';
import { pack } from './commands/pack.js';
import { inspect } from './commands/inspect.js';
import { verify } from './commands/verify.js';
import { diff } from './commands/diff.js';
import { web } from './commands/web.js';
import { parseArgs, flagBool, flagStr, flagStrs } from './util/args.js';
import { setJsonMode } from './util/logger.js';
import { CliError, EXIT } from './util/exit.js';

export async function cli(argv: string[]): Promise<void> {
  const { command, positional, flags } = parseArgs(argv);

  if (!command) {
    printRootHelp();
    return;
  }
  if (flagBool(flags, 'help')) {
    printCommandHelp(command);
    return;
  }

  const json = flagBool(flags, 'json');
  setJsonMode(json);
  try {
    validateAllowedFlags(command, flags);
    switch (command) {
      case 'extract':
        await runExtract(positional, flags, parseGlobalParseOptions(flags));
        break;
      case 'pack':
        await runPack(positional, flags);
        break;
      case 'inspect':
        await runInspect(positional, flags, json, parseGlobalParseOptions(flags));
        break;
      case 'verify':
        await verify(requireArg(command, positional[0], '<package.unitypackage>'), {
          json,
          strict: flagBool(flags, 'strict'),
          parseOptions: parseGlobalParseOptions(flags),
        });
        break;
      case 'diff':
        await diff(
          requireArg(command, positional[0], '<before.unitypackage>'),
          requireArg(command, positional[1], '<after.unitypackage>'),
          { json, parseOptions: parseGlobalParseOptions(flags) },
        );
        break;
      case 'web':
        await runWeb(flags);
        break;
      default:
        printRootHelp();
        throw new CliError(`Unknown command: ${command}`, EXIT.ERROR);
    }
  } finally {
    setJsonMode(false);
  }
}

async function runExtract(
  positional: string[],
  flags: Record<string, string | boolean | string[]>,
  parseOptions: ParseUnityPackageOptions,
): Promise<void> {
  const [packagePath, outputDir] = positional;
  if (!packagePath) throw new CliError('extract requires <package.unitypackage>', EXIT.ERROR);
  const filter = flagStr(flags, 'filter');
  const paths = flagStrs(flags, 'path');
  const pathFile = flagStr(flags, 'path-file');
  if (filter !== undefined && (paths.length > 0 || pathFile !== undefined)) {
    throw new CliError('extract --filter and --path cannot be combined.', EXIT.ERROR);
  }
  await extract(packagePath, outputDir, {
    force: flagBool(flags, 'force'),
    merge: flagBool(flags, 'merge'),
    skipExisting: flagBool(flags, 'skip-existing'),
    noMeta: flagBool(flags, 'no-meta'),
    withMeta: flagBool(flags, 'with-meta'),
    filter,
    exclude: flagStr(flags, 'exclude'),
    paths,
    pathFile,
    dryRun: flagBool(flags, 'dry-run'),
    json: flagBool(flags, 'json'),
    parseOptions,
  });
}

async function runInspect(
  positional: string[],
  flags: Record<string, string | boolean | string[]>,
  json: boolean,
  parseOptions: ParseUnityPackageOptions,
): Promise<void> {
  const format = flagStr(flags, 'format');
  if (format !== undefined && format !== 'list' && format !== 'tree') {
    throw new CliError(`Invalid inspect format: ${format}`, EXIT.ERROR);
  }
  await inspect(requireArg('inspect', positional[0], '<package.unitypackage>'), {
    json,
    format,
    filter: flagStr(flags, 'filter'),
    exclude: flagStr(flags, 'exclude'),
    parseOptions,
  });
}

async function runPack(positional: string[], flags: Record<string, string | boolean | string[]>): Promise<void> {
  const [outputFile, ...rest] = positional;
  if (!outputFile) throw new CliError('pack requires <output.unitypackage>', EXIT.ERROR);
  const manifestPath = flagStr(flags, 'manifest');
  const gzipLevelStr = flagStr(flags, 'gzip-level');
  let gzipLevel: number | undefined;

  if (gzipLevelStr !== undefined) {
    gzipLevel = Number(gzipLevelStr);
    if (!Number.isInteger(gzipLevel) || gzipLevel < 0 || gzipLevel > 9) {
      throw new CliError(`Invalid gzip level: ${gzipLevelStr}`, EXIT.ERROR);
    }
  }

  const maxDepDepthStr = flagStr(flags, 'max-dep-depth');
  let maxDepDepth: number | undefined;
  if (maxDepDepthStr !== undefined) {
    maxDepDepth = Number(maxDepDepthStr);
    if (!Number.isInteger(maxDepDepth) || maxDepDepth < 0) {
      throw new CliError(`Invalid max-dep-depth: ${maxDepDepthStr}`, EXIT.ERROR);
    }
  }

  const expanded = rest.flatMap(arg => {
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0) return [arg.slice(0, eqIdx), arg.slice(eqIdx + 1)];
    return arg;
  });
  if ((!manifestPath && expanded.length === 0) || expanded.length % 2 !== 0) {
    throw new CliError(
      'pack requires --manifest <file.json> or <source-path>=<path-in-package> pairs.\nExample: pack out.unitypackage ./MyScript.cs=Assets/MyScript.cs',
      EXIT.ERROR,
    );
  }
  const filesToPack: Record<string, string> = {};
  for (let i = 0; i < expanded.length; i += 2) {
    filesToPack[path.resolve(expanded[i])] = expanded[i + 1];
  }
  await pack(filesToPack, path.resolve(outputFile), {
    ...(manifestPath !== undefined && { manifestPath: path.resolve(manifestPath) }),
    ...(gzipLevel !== undefined && { gzipLevel }),
    ...(maxDepDepth !== undefined && { maxDepDepth }),
    randomGuids: flagBool(flags, 'random-guids'),
    resolveDeps: flagBool(flags, 'resolve-deps'),
    depRoot: flagStr(flags, 'dep-root'),
    dryRun: flagBool(flags, 'dry-run'),
    json: flagBool(flags, 'json'),
  });
}

async function runWeb(flags: Record<string, string | boolean | string[]>): Promise<void> {
  const portStr = flagStr(flags, 'port');
  const port = portStr !== undefined ? parseInt(portStr, 10) : undefined;
  if (port !== undefined && isNaN(port)) {
    throw new CliError(`Invalid port: ${portStr}`, EXIT.ERROR);
  }
  await web({ port, host: flagStr(flags, 'host') });
}

function requireArg(command: string, value: string | undefined, placeholder: string): string {
  if (!value) throw new CliError(`${command} requires ${placeholder}`, EXIT.ERROR);
  return value;
}

const globalFlags = new Set(['help', 'max-output-bytes', 'max-entries']);
const commandFlags: Record<string, Set<string>> = {
  extract: new Set([
    'filter',
    'exclude',
    'path',
    'path-file',
    'merge',
    'force',
    'skip-existing',
    'no-meta',
    'with-meta',
    'dry-run',
    'json',
  ]),
  pack: new Set(['manifest', 'gzip-level', 'random-guids', 'resolve-deps', 'dep-root', 'max-dep-depth', 'dry-run', 'json']),
  inspect: new Set(['json', 'format', 'filter', 'exclude']),
  verify: new Set(['json', 'strict']),
  diff: new Set(['json']),
  web: new Set(['port', 'host']),
};

function validateAllowedFlags(command: string, flags: Record<string, string | boolean | string[]>): void {
  const allowed = commandFlags[command];
  if (allowed === undefined) return;

  for (const name of Object.keys(flags)) {
    if (!globalFlags.has(name) && !allowed.has(name)) {
      throw new CliError(`Option --${name} is not supported by ${command}.`, EXIT.ERROR);
    }
  }
}

export function parseGlobalParseOptions(flags: Record<string, string | boolean | string[]>): ParseUnityPackageOptions {
  const maxOutputBytes = parseNonNegativeSafeIntegerFlag(flags, 'max-output-bytes');
  const maxEntries = parseNonNegativeSafeIntegerFlag(flags, 'max-entries');
  return {
    ...(maxOutputBytes !== undefined && { maxOutputBytes }),
    ...(maxEntries !== undefined && { maxEntries }),
  };
}

function parseNonNegativeSafeIntegerFlag(
  flags: Record<string, string | boolean | string[]>,
  name: string,
): number | undefined {
  const raw = flagStr(flags, name);
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CliError(`Invalid --${name}: ${raw}. Expected a non-negative safe integer.`, EXIT.ERROR);
  }
  return value;
}

function printRootHelp(): void {
  console.log(`\
Usage: unitypackage-tools <command> [options]

Commands:
  extract   Extract files from a .unitypackage archive
  pack      Create a .unitypackage archive from source files
  inspect   Inspect contents of a .unitypackage archive
  verify    Verify structure and integrity of a .unitypackage archive
  diff      Compare two .unitypackage archives
  web       Launch the web UI for browsing .unitypackage files

Global:
  --max-output-bytes <n>  Safety limit for decompressed package bytes
  --max-entries <n>       Safety limit for parsed package entries
  -h, --help               Show this help

Run 'unitypackage-tools <command> --help' for command-specific options.`);
}

function printCommandHelp(command: string): void {
  switch (command) {
    case 'extract':
      console.log(`\
Usage: unitypackage-tools extract <package.unitypackage> [output-dir] [options]

Extract files from a .unitypackage archive.

Selection (mutually exclusive):
    --filter <glob>    Match full package pathnames, e.g. **/*.shader
    --path <pathname>  Extract one exact package pathname (repeatable)
    --path-file <file> Read exact package pathnames from a line-delimited file

Filtering:
    --exclude <glob>   Exclude full package pathnames matching glob

Output:
    --force            Overwrite existing files
    --skip-existing    Skip files that already exist
    --merge            Merge into an existing directory
    --no-meta          Do not write .meta files
    --with-meta        Include sidecars for exact --path selections

Operational:
    --dry-run          Plan extraction without writing files
    --json             Write result as JSON to stdout

Global:
  --max-output-bytes <n>  Safety limit for decompressed package bytes
  --max-entries <n>       Safety limit for parsed package entries
  -h, --help               Show this help`);
      break;

    case 'pack':
      console.log(`\
Usage: unitypackage-tools pack <output.unitypackage> [src dest]... [options]

Create a .unitypackage archive from source files.

Source specification (mutually exclusive with [src dest]...):
    --manifest <file>  Read JSON { "src": "dst" } pairs from file

Compression:
    --gzip-level <0-9> Set gzip compression level (default: 6)

GUID handling:
    --random-guids     Generate non-reproducible GUIDs for missing .meta

Dependency resolution:
    --resolve-deps     Automatically resolve and include Unity GUID dependencies
    --dep-root <path>  Root Assets directory for dependency resolution (default: auto-detect)
    --max-dep-depth <n> Maximum dependency depth (default: unlimited)

Operational:
    --dry-run          Validate and plan package creation without writing
    --json             Write result as JSON to stdout

Global:
  --max-output-bytes <n>  Safety limit for decompressed package bytes
  --max-entries <n>       Safety limit for parsed package entries
  -h, --help               Show this help`);
      break;

    case 'inspect':
      console.log(`\
Usage: unitypackage-tools inspect <package.unitypackage> [options]

Inspect contents of a .unitypackage archive.

Options:
    --format <format>  Output format: list (default) or tree
    --filter <filter>  Show only entries matching extension or glob
    --exclude <glob>   Exclude full package pathnames
    --json             Write result as JSON to stdout

Global:
  --max-output-bytes <n>  Safety limit for decompressed package bytes
  --max-entries <n>       Safety limit for parsed package entries
  -h, --help               Show this help`);
      break;

    case 'verify':
      console.log(`\
Usage: unitypackage-tools verify <package.unitypackage> [options]

Verify structure and integrity of a .unitypackage archive.

Options:
    --strict           Fail when warnings are present (default: warn only)
    --json             Write result as JSON to stdout

Global:
  --max-output-bytes <n>  Safety limit for decompressed package bytes
  --max-entries <n>       Safety limit for parsed package entries
  -h, --help               Show this help`);
      break;

    case 'diff':
      console.log(`\
Usage: unitypackage-tools diff <before.unitypackage> <after.unitypackage> [options]

Compare two .unitypackage archives and show file-level changes.

Options:
    --json             Write result as JSON to stdout

Global:
  --max-output-bytes <n>  Safety limit for decompressed package bytes
  --max-entries <n>       Safety limit for parsed package entries
  -h, --help               Show this help`);
      break;

    case 'web':
      console.log(`\
Usage: unitypackage-tools web [options]

Launch the web UI for browsing and extracting .unitypackage files.

Options:
    --port <n>         HTTP port (default: 5173)
    --host <host>      Bind address (default: localhost)

Global:
  --max-output-bytes <n>  Safety limit for decompressed package bytes
  --max-entries <n>       Safety limit for parsed package entries
  -h, --help               Show this help`);
      break;

    default:
      printRootHelp();
  }
}
