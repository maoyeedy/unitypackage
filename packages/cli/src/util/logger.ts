let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function info(msg: string): void {
  if (!jsonMode) console.log(msg);
}

export function warn(msg: string): void {
  if (jsonMode) {
    process.stderr.write(JSON.stringify({ level: 'warn', message: msg }) + '\n');
  } else {
    console.warn(`WARNING: ${msg}`);
  }
}

export function error(msg: string): void {
  if (jsonMode) {
    process.stderr.write(JSON.stringify({ level: 'error', message: msg }) + '\n');
  } else {
    console.error(`ERROR: ${msg}`);
  }
}
