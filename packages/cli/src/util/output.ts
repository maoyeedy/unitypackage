export function writeJsonResult(result: unknown): void {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
