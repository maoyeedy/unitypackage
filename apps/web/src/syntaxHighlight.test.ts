import { describe, expect, it } from 'vitest';

import { highlightCode } from './syntaxHighlight';

describe('syntax highlighting', () => {
  it('highlights mapped Unity YAML without injecting HTML', async () => {
    const result = await highlightCode('fileFormatVersion: 2', 'yaml', 'light');

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.map(token => token.content).join('')).toBe('fileFormatVersion: 2');
    expect(result.background).toBeTruthy();
  });

  it('falls back to plain text language', async () => {
    const result = await highlightCode('plain preview', 'text', 'dark');

    expect(result.lines[0]?.map(token => token.content).join('')).toBe('plain preview');
    expect(result.background).toBeTruthy();
  });
});
