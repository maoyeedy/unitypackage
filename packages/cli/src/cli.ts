import path from 'node:path';
import type { ParseUnityPackageOptions } from 'unitypackage-core';
import { extract } from './commands/extract.js';
import { pack } from './commands/pack.js';
import { inspect } from './commands/inspect.js';
import { verify } from './commands/verify.js';
import { diff } from './commands/diff.js';
import { web } from './commands/web.js';
import { parseArgs, flagBool, flagStr, flagStrs } from './util/args.js';
import { error, setJsonMode } from './util/logger.js';
import { CliError, EXIT, mapCliError } from './util/exit.js';

export async function cli(argv: string[]): Promise<void> {
  const { command, positional, flags } = parseArgs(argv);

  if (!command || flagBool(flags, 'h') || flagBool(flags, 'help')) {
    printHelp();
    return;
  }

  const json = flagBool(flags, 'json');
  if (json) setJsonMode(true);

  try {
    const parseOptions = parseGlobalParseOptions(flags);
    switch (command) {
      case 'extract':
        await runExtract(positional, flags, parseOptions);
        break;
      case 'pack':
        await runPack(positional, flags);
        break;
      case 'inspect':
        await runInspect(positional, flags, json, parseOptions);
        break;
      case 'verify':
        await verify(requireArg(command, positional[0], '<package.unitypackage>'), {
          json,
          strict: flagBool(flags, 'strict'),
          parseOptions,
        });
        break;
      case 'diff':
        await diff(
          requireArg(command, positional[0], '<before.unitypackage>'),
          requireArg(command, positional[1], '<after.unitypackage>'),
          { json, parseOptions },
        );
        break;
      case 'web':
        await runWeb(flags);
        break;
      default:
        error(`Unknown command: ${command}`);
        printHelp();
        process.exit(EXIT.ERROR);
    }
  } catch (err) {
    const mapped = mapCliError(err);
    error(mapped.message);
    process.exit(mapped.code);
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

  if ((!manifestPath && rest.length === 0) || rest.length % 2 !== 0) {
    throw new CliError(
      'pack requires --manifest <file.json> or pairs of <source-path> <path-in-package>.\nExample: pack out.unitypackage ./MyScript.cs Assets/MyScript.cs',
      EXIT.ERROR,
    );
  }
  const filesToPack: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    filesToPack[path.resolve(rest[i])] = rest[i + 1];
  }
  await pack(filesToPack, path.resolve(outputFile), {
    ...(manifestPath !== undefined && { manifestPath: path.resolve(manifestPath) }),
    ...(gzipLevel !== undefined && { gzipLevel }),
    randomGuids: flagBool(flags, 'random-guids'),
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

function printHelp(): void {
  console.log(`\
Usage: unitypackage-tools <command> [options]

Commands:
  extract <package.unitypackage> [output-dir]
    --filter <glob>    Match full package pathnames, e.g. **/*.shader
    --exclude <glob>   Exclude full package pathnames
    --path <pathname>  Extract one exact package pathname; repeatable
    --path-file <file> Read exact package pathnames from a line-delimited file
    --merge            Merge into an existing directory
    --force            Overwrite existing files
    --skip-existing    Skip files that already exist
    --no-meta          Do not write .meta files
    --with-meta        Include sidecars for exact --path asset selections
    --dry-run          Plan extraction without writing files
    --json             Write extract plan/result as JSON

  pack <output.unitypackage> [src dest]...
    --manifest <file>  Read JSON { "src": "dst" } pairs
    --gzip-level <0-9> Set gzip compression level
    --random-guids     Generate non-reproducible GUIDs for missing .meta files
    --dry-run          Validate and plan package creation without writing
    --json             Write pack plan/result as JSON

  inspect <package.unitypackage>
    --json             Write inspect result as JSON
    --format <format>  Output format: list or tree
    --filter <filter>  Show only entries matching extension or glob
    --exclude <glob>   Exclude full package pathnames

  verify <package.unitypackage>
    --json             Write verify result as JSON
    --strict           Fail when warnings are present

  diff <before.unitypackage> <after.unitypackage>
    --json             Write diff result as JSON

  web [--port <n>] [--host <host>]
                      Serve the web UI (default: 5173)

Global:
  --max-output-bytes <n>
                      Safety limit for decompressed package bytes
  --max-entries <n>   Safety limit for parsed package entries
  -h, --help           Show this help`);
}
