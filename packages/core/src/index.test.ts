import { describe, expect, it } from 'vitest';
import { parseUnityPackageEntries } from './index';

// Keeps the public barrel covered after the implementation modules are split.
describe('public barrel', () => {
  it('exports parseUnityPackageEntries from the root entry point', () => {
    expect(parseUnityPackageEntries).toBeTypeOf('function');
  });
});
