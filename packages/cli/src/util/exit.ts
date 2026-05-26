export const EXIT = {
  OK: 0,
  WARN: 1,
  ERROR: 2,
  IO: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: ExitCode = EXIT.ERROR,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
