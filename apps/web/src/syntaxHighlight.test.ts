import { describe, expect, it } from 'vitest';

import { highlightCode, findQueryMatches, splitLineTokensForMatches } from './syntaxHighlight';

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

  it('highlights chunked code inputs', async () => {
    const longText = 'line1\nline2\nline3\nline4\nline5';
    // Highlight a chunk (slice of lines)
    const chunk = longText.split('\n').slice(1, 4).join('\n'); // line2\nline3\nline4
    const result = await highlightCode(chunk, 'text', 'light');
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]?.map(t => t.content).join('')).toBe('line2');
    expect(result.lines[1]?.map(t => t.content).join('')).toBe('line3');
    expect(result.lines[2]?.map(t => t.content).join('')).toBe('line4');
  });
});

describe('findQueryMatches', () => {
  it('finds case-insensitive occurrences across lines', () => {
    const lines = ['Hello World', 'world of coding', 'no match here', 'World!'];
    const result = findQueryMatches(lines, 'world');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ lineIndex: 0, indexInLine: 6, length: 5, globalIndex: 0 });
    expect(result[1]).toEqual({ lineIndex: 1, indexInLine: 0, length: 5, globalIndex: 1 });
    expect(result[2]).toEqual({ lineIndex: 3, indexInLine: 0, length: 5, globalIndex: 2 });
  });

  it('handles empty query', () => {
    const result = findQueryMatches(['some text'], '');
    expect(result).toEqual([]);
  });

  it('finds multiple matches on the same line', () => {
    const lines = ['banana'];
    const result = findQueryMatches(lines, 'an');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ lineIndex: 0, indexInLine: 1, length: 2, globalIndex: 0 });
    expect(result[1]).toEqual({ lineIndex: 0, indexInLine: 3, length: 2, globalIndex: 1 });
  });
});

describe('splitLineTokensForMatches', () => {
  it('does not split if there are no matches', () => {
    const tokens = [{ content: 'hello' }, { content: ' ' }, { content: 'world' }];
    const result = splitLineTokensForMatches(tokens, [], null);
    expect(result).toBe(tokens);
  });

  it('splits a single token containing a match', () => {
    const tokens = [{ content: 'helloworld', color: '#111' }];
    // Match "world" at index 5, length 5
    const matches = [{ indexInLine: 5, length: 5, globalIndex: 0 }];
    const result = splitLineTokensForMatches(tokens, matches, 0);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ content: 'hello', color: '#111' });
    expect(result[1]).toEqual({ content: 'world', color: '#111', isMatch: true, isActiveMatch: true });
  });

  it('splits and flags active/inactive matches correctly', () => {
    const tokens = [{ content: 'banana', color: '#111' }];
    // matches: "an" at index 1, "an" at index 3
    const matches = [
      { indexInLine: 1, length: 2, globalIndex: 0 },
      { indexInLine: 3, length: 2, globalIndex: 1 },
    ];

    const result = splitLineTokensForMatches(tokens, matches, 1);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ content: 'b', color: '#111' });
    expect(result[1]).toEqual({ content: 'an', color: '#111', isMatch: true, isActiveMatch: false });
    expect(result[2]).toEqual({ content: 'an', color: '#111', isMatch: true, isActiveMatch: true });
    expect(result[3]).toEqual({ content: 'a', color: '#111' });
  });
});

