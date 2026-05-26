export const EXIT = {
  OK: 0,
  WARN: 1,
  ERROR: 2,
  IO: 3,
  BOMB: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

interface DecompressionBombLike {
  name: 'DecompressionBombError';
  kind?: unknown;
  observed?: unknown;
}

export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: ExitCode = EXIT.ERROR,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function isDecompressionBombError(err: unknown): err is DecompressionBombLike {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'DecompressionBombError';
}

export function formatDecompressionBombError(err: DecompressionBombLike): string {
  const kind = typeof err.kind === 'string' ? err.kind : 'unknown';
  const observed = typeof err.observed === 'number' || typeof err.observed === 'string'
    ? String(err.observed)
    : 'unknown';
  return `Decompression bomb guard triggered: kind=${kind} observed=${observed}`;
}

export function mapCliError(err: unknown): { message: string; code: ExitCode } {
  if (isDecompressionBombError(err)) {
    return { message: formatDecompressionBombError(err), code: EXIT.BOMB };
  }
  if (err instanceof CliError) {
    return { message: err.message, code: err.code };
  }
  return { message: err instanceof Error ? err.message : String(err), code: EXIT.ERROR };
}
