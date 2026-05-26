import path from 'node:path';
import { extract } from './commands/extract.js';
import { pack } from './commands/pack.js';
import { inspect } from './commands/inspect.js';
import { verify } from './commands/verify.js';
import { diff } from './commands/diff.js';
import { doctor } from './commands/doctor.js';
import { web } from './commands/web.js';
import { parseArgs, flagBool, flagStr } from './util/args.js';
import { error, setJsonMode } from './util/logger.js';
import { CliError, EXIT } from './util/exit.js';

export async function cli(argv: string[]): Promise<void> {
  const { command, positional, flags } = parseArgs(argv);

  if (!command || flagBool(flags, 'h') || flagBool(flags, 'help')) {
    printHelp();
    return;
  }

  const json = flagBool(flags, 'json');
  if (json) setJsonMode(true);

  try {
    switch (command) {
      case 'extract':
        await runExtract(positional, flags);
        break;
      case 'pack':
        await runPack(positional, flags);
        break;
      case 'inspect':
        await runInspect(positional, flags, json);
        break;
      case 'verify':
        await verify(requireArg(command, positional[0], '<package.unitypackage>'), { json, strict: flagBool(flags, 'strict') });
        break;
      case 'diff':
        await diff(
          requireArg(command, positional[0], '<before.unitypackage>'),
          requireArg(command, positional[1], '<after.unitypackage>'),
          { json },
        );
        break;
      case 'doctor':
        await doctor(requireArg(command, positional[0], '<package.unitypackage>'), { json });
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
    if (err instanceof CliError) {
      error(err.message);
      process.exit(err.code);
    }
    error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT.ERROR);
  }
}

async function runExtract(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [packagePath, outputDir] = positional;
  if (!packagePath) throw new CliError('extract requires <package.unitypackage>', EXIT.ERROR);
  await extract(packagePath, outputDir, {
    force: flagBool(flags, 'force'),
    merge: flagBool(flags, 'merge'),
    skipExisting: flagBool(flags, 'skip-existing'),
    noMeta: flagBool(flags, 'no-meta'),
    filter: flagStr(flags, 'filter'),
  });
}

async function runInspect(positional: string[], flags: Record<string, string | boolean>, json: boolean): Promise<void> {
  const format = flagStr(flags, 'format');
  if (format !== undefined && format !== 'list' && format !== 'tree') {
    throw new CliError(`Invalid inspect format: ${format}`, EXIT.ERROR);
  }
  await inspect(requireArg('inspect', positional[0], '<package.unitypackage>'), {
    json,
    format,
    filter: flagStr(flags, 'filter'),
  });
}

async function runPack(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
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
  });
}

async function runWeb(flags: Record<string, string | boolean>): Promise<void> {
  const portStr = flagStr(flags, 'port');
  const port = portStr !== undefined ? parseInt(portStr, 10) : undefined;
  if (port !== undefined && isNaN(port)) {
    throw new CliError(`Invalid port: ${portStr}`, EXIT.ERROR);
  }
  await web({ port });
}

function requireArg(command: string, value: string | undefined, placeholder: string): string {
  if (!value) throw new CliError(`${command} requires ${placeholder}`, EXIT.ERROR);
  return value;
}

function printHelp(): void {
  console.log(`\
Usage: unitypackage-tools <command> [options]

Commands:
  extract <package.unitypackage> [output-dir]   Extract assets to disk
  pack <output.unitypackage> [src dest]...       Pack files into a package
  inspect <package.unitypackage> [--json]        Show package summary
  verify <package.unitypackage> [--json]         Validate package structure
  diff <pkg-a> <pkg-b> [--json]                  Compare package entries
  doctor <package.unitypackage> [--json]         Report package health checks
  web [--port <n>]                               Serve the web UI (default: 5173)

Flags:
  -h, --help                                     Show this help

extract flags:
  --force            Overwrite existing files
  --merge            Merge into an existing directory
  --skip-existing    Skip files that already exist
  --no-meta          Do not write .meta files
  --filter <glob>    Extract only matching pathnames

pack flags:
  --manifest <file>  Read JSON { "src": "dst" } pairs
  --gzip-level <0-9> Set gzip compression level

inspect / verify:
  --format <format>  Inspect output format: list or tree
  --filter <ext>     Inspect only entries with extension
  --strict           Fail verify when warnings are present

diff / doctor:
  --json             Machine-readable JSON output`);
}
