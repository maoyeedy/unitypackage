function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

export function matchesGlob(value: string, glob: string): boolean {
  let pattern = '^';

  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    const next = glob[i + 1];

    if (char === '*') {
      if (next === '*') {
        pattern += '.*';
        i++;
      } else {
        pattern += '[^/]*';
      }
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += escapeRegexChar(char);
    }
  }

  pattern += '$';
  return new RegExp(pattern).test(value);
}
