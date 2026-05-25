import { describe, expect, it } from 'vitest';
import { summarizePackage, type UnityPackageEntry, type UnityPackageParseDiagnostic } from './index';

const encoder = new TextEncoder();

// Helpers for summarizePackage tests
// ---------------------------------------------------------------------------

function makeEntry(
  guid: string,
  pathname: string,
  asset?: string,
  meta?: string,
  preview?: string,
): UnityPackageEntry {
  return {
    guid,
    pathname,
    asset: asset !== undefined ? encoder.encode(asset) : undefined,
    meta: meta !== undefined ? encoder.encode(meta) : undefined,
    preview: preview !== undefined ? encoder.encode(preview) : undefined,
  };
}

describe('summarizePackage', () => {
  it('returns zero counts for an empty entry list', () => {
    const summary = summarizePackage([]);
    expect(summary.entryCount).toBe(0);
    expect(summary.fileCount).toBe(0);
    expect(summary.folderCount).toBe(0);
    expect(summary.previewCount).toBe(0);
    expect(summary.uniqueGuidCount).toBe(0);
    expect(summary.duplicateGuidCount).toBe(0);
    expect(summary.totalAssetBytes).toBe(0);
    expect(summary.totalMetaBytes).toBe(0);
    expect(summary.totalPreviewBytes).toBe(0);
    expect(summary.byExtension).toEqual([]);
    expect(summary.diagnosticsBySeverity).toEqual({ info: 0, warning: 0, error: 0 });
  });

  it('zeroes diagnosticsBySeverity when diagnostics is omitted', () => {
    const summary = summarizePackage([makeEntry('a'.repeat(32), 'Assets/A.cs', 'body', 'meta')]);
    expect(summary.diagnosticsBySeverity).toEqual({ info: 0, warning: 0, error: 0 });
  });

  it('zeroes diagnosticsBySeverity when diagnostics is an empty array', () => {
    const summary = summarizePackage([], []);
    expect(summary.diagnosticsBySeverity).toEqual({ info: 0, warning: 0, error: 0 });
  });

  it('counts files (entries with asset) and folders (entries without asset)', () => {
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/Script.cs', 'class A {}', 'meta a'),
      makeEntry('b'.repeat(32), 'Assets/Texture.png', 'png bytes', 'meta b'),
      makeEntry('c'.repeat(32), 'Assets/SubFolder', undefined, 'folder meta'),
    ];
    const summary = summarizePackage(entries);
    expect(summary.entryCount).toBe(3);
    expect(summary.fileCount).toBe(2);
    expect(summary.folderCount).toBe(1);
  });

  it('counts entries with preview present', () => {
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/A.cs', 'body', 'meta', 'preview data'),
      makeEntry('b'.repeat(32), 'Assets/B.cs', 'body', 'meta'),
    ];
    const summary = summarizePackage(entries);
    expect(summary.previewCount).toBe(1);
    expect(summary.totalPreviewBytes).toBe(encoder.encode('preview data').byteLength);
  });

  it('sums asset, meta, and preview bytes correctly', () => {
    const assetBody = 'class A {}';
    const metaBody = 'guid: aaaa';
    const previewBody = 'thumbnail';
    const entry = makeEntry('a'.repeat(32), 'Assets/A.cs', assetBody, metaBody, previewBody);
    const summary = summarizePackage([entry]);
    expect(summary.totalAssetBytes).toBe(encoder.encode(assetBody).byteLength);
    expect(summary.totalMetaBytes).toBe(encoder.encode(metaBody).byteLength);
    expect(summary.totalPreviewBytes).toBe(encoder.encode(previewBody).byteLength);
  });

  it('counts unique and duplicate GUIDs', () => {
    const guidA = 'a'.repeat(32);
    const guidB = 'b'.repeat(32);
    const entries: UnityPackageEntry[] = [
      makeEntry(guidA, 'Assets/First.cs', 'first', 'meta'),
      makeEntry(guidA, 'Assets/FirstDup.cs', 'dup', 'meta'),  // duplicate GUID
      makeEntry(guidB, 'Assets/Second.cs', 'second', 'meta'),
    ];
    const summary = summarizePackage(entries);
    expect(summary.entryCount).toBe(3);
    expect(summary.uniqueGuidCount).toBe(2);
    expect(summary.duplicateGuidCount).toBe(1);
  });

  it('builds byExtension with lower-cased extensions', () => {
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/A.CS', 'a', 'meta'),
      makeEntry('b'.repeat(32), 'Assets/B.cs', 'b', 'meta'),
      makeEntry('c'.repeat(32), 'Assets/C.PNG', 'c', 'meta'),
    ];
    const summary = summarizePackage(entries);
    const exts = summary.byExtension.map(e => e.extension);
    expect(exts).toContain('cs');
    expect(exts).toContain('png');
    expect(exts).not.toContain('CS');
    expect(exts).not.toContain('PNG');
  });

  it('treats extensionless entries as extension ""', () => {
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/Folder', undefined, 'meta'),
      makeEntry('b'.repeat(32), 'Assets/OtherFolder', undefined, 'meta'),
    ];
    const summary = summarizePackage(entries);
    const empty = summary.byExtension.find(e => e.extension === '');
    expect(empty).toBeDefined();
    expect(empty!.count).toBe(2);
    expect(empty!.assetBytes).toBe(0);
  });

  it('orders byExtension descending by count, ties broken by extension ascending', () => {
    // cs: 3 entries, png: 3 entries, shader: 1 entry
    // ties: cs and png both have 3 -- cs comes before png alphabetically
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/A.cs', 'a', 'meta'),
      makeEntry('b'.repeat(32), 'Assets/B.cs', 'b', 'meta'),
      makeEntry('c'.repeat(32), 'Assets/C.cs', 'c', 'meta'),
      makeEntry('d'.repeat(32), 'Assets/D.png', 'd', 'meta'),
      makeEntry('e'.repeat(32), 'Assets/E.png', 'e', 'meta'),
      makeEntry('f'.repeat(32), 'Assets/F.png', 'f', 'meta'),
      makeEntry('g'.repeat(32), 'Assets/G.shader', 'g', 'meta'),
    ];
    const summary = summarizePackage(entries);
    expect(summary.byExtension[0].extension).toBe('cs');
    expect(summary.byExtension[0].count).toBe(3);
    expect(summary.byExtension[1].extension).toBe('png');
    expect(summary.byExtension[1].count).toBe(3);
    expect(summary.byExtension[2].extension).toBe('shader');
    expect(summary.byExtension[2].count).toBe(1);
  });

  it('accumulates assetBytes correctly per extension', () => {
    const aBody = 'aaaa';    // 4 bytes
    const bBody = 'bbbbbb';  // 6 bytes
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/A.cs', aBody, 'meta'),
      makeEntry('b'.repeat(32), 'Assets/B.cs', bBody, 'meta'),
    ];
    const summary = summarizePackage(entries);
    const csEntry = summary.byExtension.find(e => e.extension === 'cs');
    expect(csEntry).toBeDefined();
    expect(csEntry!.assetBytes).toBe(
      encoder.encode(aBody).byteLength + encoder.encode(bBody).byteLength,
    );
  });

  it('counts diagnostics by severity correctly', () => {
    const diags: UnityPackageParseDiagnostic[] = [
      { code: 'meta-missing', message: 'missing meta', severity: 'warning', guid: 'a'.repeat(32) },
      { code: 'zero-byte-asset', message: 'zero byte', severity: 'warning', guid: 'b'.repeat(32) },
      { code: 'duplicate-guid', message: 'dup guid', severity: 'error', guid: 'c'.repeat(32) },
      { code: 'non-standard-guid', message: 'non-std', severity: 'info', guid: 'x' },
      { code: 'ignored-preview', message: 'preview', severity: 'info', guid: 'd'.repeat(32) },
    ];
    const summary = summarizePackage([], diags);
    expect(summary.diagnosticsBySeverity.warning).toBe(2);
    expect(summary.diagnosticsBySeverity.error).toBe(1);
    expect(summary.diagnosticsBySeverity.info).toBe(2);
  });

  it('handles a synthetic mixed-asset fixture with files, folders, previews, and diagnostics', () => {
    // 2 cs files, 1 png file with preview, 1 folder entry, 1 entry with duplicate GUID
    const guidA = 'a'.repeat(32);
    const guidB = 'b'.repeat(32);
    const guidC = 'c'.repeat(32);
    const guidD = 'd'.repeat(32);
    const entries: UnityPackageEntry[] = [
      makeEntry(guidA, 'Assets/Script1.cs', 'class S1 {}', 'meta a'),
      makeEntry(guidB, 'Assets/Script2.cs', 'class S2 {}', 'meta b'),
      makeEntry(guidC, 'Assets/Sprite.png', 'png data', 'meta c', 'preview bytes'),
      makeEntry(guidD, 'Assets/SubFolder', undefined, 'folder meta'),
      makeEntry(guidA, 'Assets/Script1Dup.cs', 'dup', 'meta dup'), // duplicate guidA
    ];
    const diags: UnityPackageParseDiagnostic[] = [
      { code: 'duplicate-guid', message: 'dup', severity: 'error', guid: guidA },
    ];
    const summary = summarizePackage(entries, diags);

    expect(summary.entryCount).toBe(5);
    expect(summary.fileCount).toBe(4);   // Script1, Script2, Sprite, Script1Dup all have asset
    expect(summary.folderCount).toBe(1); // SubFolder
    expect(summary.previewCount).toBe(1);
    expect(summary.uniqueGuidCount).toBe(4); // a, b, c, d
    expect(summary.duplicateGuidCount).toBe(1);
    expect(summary.totalPreviewBytes).toBe(encoder.encode('preview bytes').byteLength);

    // byExtension: cs has 3 entries (Script1, Script2, Dup), png has 1, '' has 1
    const csExt = summary.byExtension.find(e => e.extension === 'cs');
    const pngExt = summary.byExtension.find(e => e.extension === 'png');
    const emptyExt = summary.byExtension.find(e => e.extension === '');
    expect(csExt!.count).toBe(3);
    expect(pngExt!.count).toBe(1);
    expect(emptyExt!.count).toBe(1);
    // Ordering: cs(3) > png(1) == ''(1) -- png before '' alphabetically
    expect(summary.byExtension[0].extension).toBe('cs');
    expect(summary.byExtension[1].extension).toBe('');  // '' < 'png' alphabetically
    expect(summary.byExtension[2].extension).toBe('png');

    expect(summary.diagnosticsBySeverity.error).toBe(1);
    expect(summary.diagnosticsBySeverity.warning).toBe(0);
    expect(summary.diagnosticsBySeverity.info).toBe(0);
  });
});
