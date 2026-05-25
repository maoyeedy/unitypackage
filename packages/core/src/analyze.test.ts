import { describe, expect, it } from 'vitest';
import { analyzeUnityPackageEntries, type UnityPackageEntry, type UnityPackageParseDiagnostic } from './index';

const encoder = new TextEncoder();

describe('analyzeUnityPackageEntries', () => {
  it('reports meta GUID mismatch, missing meta, duplicate GUID, and pathname collisions', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/File.cs',
        asset: encoder.encode('code'),
        meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nMonoImporter:\n'),
      },
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/File.cs',
        asset: encoder.encode('code 2'),
      },
      {
        guid: 'cccccccccccccccccccccccccccccccc',
        pathname: 'Assets/file.cs',
        asset: encoder.encode('code 3'),
        meta: encoder.encode('guid: cccccccccccccccccccccccccccccccc\nMonoImporter:\n'),
      },
    ];

    const codes = analyzeUnityPackageEntries(entries).findings.map(finding => finding.code);

    expect(codes).toContain('meta-guid-mismatch');
    expect(codes).toContain('meta-missing');
    expect(codes).toContain('duplicate-guid');
    expect(codes).toContain('duplicate-pathname');
  });

  it('reports unsafe paths and rolls up parser diagnostics by severity', () => {
    const parseDiagnostics: UnityPackageParseDiagnostic[] = [{
      code: 'malformed-tar-entry',
      message: 'bad',
      severity: 'error',
      path: 'bad',
    }];

    const result = analyzeUnityPackageEntries([{
      guid: 'dddddddddddddddddddddddddddddddd',
      pathname: '../Unsafe.asset',
      asset: encoder.encode('asset'),
      meta: encoder.encode('guid: dddddddddddddddddddddddddddddddd\nDefaultImporter:\n'),
    }], parseDiagnostics);

    expect(result.findings.map(finding => finding.code)).toEqual(['parser-diagnostic', 'unsafe-pathname']);
    expect(result.summary.error).toBe(2);
  });

  it('does not flag unknown real importers as mismatches', () => {
    const result = analyzeUnityPackageEntries([{
      guid: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      pathname: 'Assets/Texture.png',
      asset: encoder.encode('png'),
      meta: encoder.encode('guid: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\nTextureImporter:\n'),
    }]);

    expect(result.findings.map(finding => finding.code)).not.toContain('meta-importer-mismatch');
  });

  it('flags known importer mismatches', () => {
    const result = analyzeUnityPackageEntries([{
      guid: 'ffffffffffffffffffffffffffffffff',
      pathname: 'Assets/Script.cs',
      asset: encoder.encode('code'),
      meta: encoder.encode('guid: ffffffffffffffffffffffffffffffff\nDefaultImporter:\n'),
    }]);

    expect(result.findings.map(finding => finding.code)).toContain('meta-importer-mismatch');
  });
});
