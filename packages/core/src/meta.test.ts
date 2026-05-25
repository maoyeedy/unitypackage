import { describe, expect, it } from 'vitest';
import {
  createMinimalFolderMeta,
  createMinimalMeta,
  createMinimalMetaFor,
  detectMetaImporterType,
} from './index';

describe('createMinimalMeta', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('returns a string starting with "fileFormatVersion: 2"', () => {
    const result = createMinimalMeta(validGuid);
    expect(result.startsWith('fileFormatVersion: 2')).toBe(true);
  });

  it('includes the supplied GUID on a "guid: " line', () => {
    const result = createMinimalMeta(validGuid);
    expect(result).toContain(`guid: ${validGuid}`);
  });

  it('contains the DefaultImporter block', () => {
    const result = createMinimalMeta(validGuid);
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('  externalObjects: {}');
    expect(result).toContain('  userData:');
    expect(result).toContain('  assetBundleName:');
    expect(result).toContain('  assetBundleVariant:');
  });

  it('produces byte-stable output across two calls with the same GUID', () => {
    const first = createMinimalMeta(validGuid);
    const second = createMinimalMeta(validGuid);
    expect(first).toBe(second);
  });

  it('produces different output for different GUIDs', () => {
    const other = 'abcdef0123456789abcdef0123456789';
    expect(createMinimalMeta(validGuid)).not.toBe(createMinimalMeta(other));
  });

  it('throws for an empty string', () => {
    expect(() => createMinimalMeta('')).toThrow('""');
  });

  it('throws for an uppercase GUID', () => {
    expect(() => createMinimalMeta('0123456789ABCDEF0123456789ABCDEF')).toThrow(
      '0123456789ABCDEF0123456789ABCDEF',
    );
  });

  it('throws for a 31-character GUID', () => {
    const short = '0'.repeat(31);
    expect(() => createMinimalMeta(short)).toThrow(short);
  });

  it('throws for a 33-character GUID', () => {
    const long = '0'.repeat(33);
    expect(() => createMinimalMeta(long)).toThrow(long);
  });

  it('throws for a non-hex GUID', () => {
    const nonHex = '0123456789abcdef0123456789abcdez';
    expect(() => createMinimalMeta(nonHex)).toThrow(nonHex);
  });

  it('returns text; encoding to UTF-8 is the caller\'s responsibility', () => {
    const result = createMinimalMeta(validGuid);
    const bytes = new TextEncoder().encode(result);
    expect(new TextDecoder().decode(bytes)).toBe(result);
  });
});

describe('detectMetaImporterType', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('returns DefaultImporterFolder when isDir is true', () => {
    expect(detectMetaImporterType('Assets/MyFolder', true)).toBe('DefaultImporterFolder');
    expect(detectMetaImporterType('Assets/Script.cs', true)).toBe('DefaultImporterFolder');
  });

  it('returns MonoImporter for .cs extension', () => {
    expect(detectMetaImporterType('Assets/MyScript.cs')).toBe('MonoImporter');
    expect(detectMetaImporterType('Assets/Sub/Deep.cs')).toBe('MonoImporter');
  });

  it('returns TextScriptImporter for .json', () => {
    expect(detectMetaImporterType('Assets/config.json')).toBe('TextScriptImporter');
  });

  it('returns TextScriptImporter for .txt', () => {
    expect(detectMetaImporterType('Assets/readme.txt')).toBe('TextScriptImporter');
  });

  it('returns TextScriptImporter for .md', () => {
    expect(detectMetaImporterType('Assets/docs.md')).toBe('TextScriptImporter');
  });

  it('returns TextScriptImporter for .asmdef', () => {
    expect(detectMetaImporterType('Assets/MyAssembly.asmdef')).toBe('TextScriptImporter');
  });

  it('returns DefaultImporter for .yaml', () => {
    expect(detectMetaImporterType('Assets/scene.yaml')).toBe('DefaultImporter');
  });

  it('returns DefaultImporter for .yml', () => {
    expect(detectMetaImporterType('Assets/config.yml')).toBe('DefaultImporter');
  });

  it('returns DefaultImporter for .png', () => {
    expect(detectMetaImporterType('Assets/sprite.png')).toBe('DefaultImporter');
  });

  it('returns DefaultImporter for .prefab', () => {
    expect(detectMetaImporterType('Assets/MyPrefab.prefab')).toBe('DefaultImporter');
  });

  it('returns DefaultImporter for unknown extension', () => {
    expect(detectMetaImporterType('Assets/data.unknownxyz')).toBe('DefaultImporter');
  });

  it('returns TextScriptImporter for bare LICENSE basename (no extension)', () => {
    expect(detectMetaImporterType('LICENSE')).toBe('TextScriptImporter');
    expect(detectMetaImporterType('Assets/LICENSE')).toBe('TextScriptImporter');
    expect(detectMetaImporterType('someDir/LICENSE')).toBe('TextScriptImporter');
  });

  it('returns DefaultImporterFolder for extensionless path that is not LICENSE', () => {
    expect(detectMetaImporterType('Assets/SomeFolder')).toBe('DefaultImporterFolder');
    expect(detectMetaImporterType('Assets/Sub/AnotherFolder')).toBe('DefaultImporterFolder');
  });

  void validGuid; // suppress unused-variable lint in this describe block
});

// ---------------------------------------------------------------------------
// createMinimalMetaFor
// ---------------------------------------------------------------------------

describe('createMinimalMetaFor', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('produces MonoImporter YAML for a .cs file', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/MyScript.cs');
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('MonoImporter:');
    expect(result).toContain('serializedVersion: 2');
  });

  it('produces TextScriptImporter YAML for a .json file', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/config.json');
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('TextScriptImporter:');
  });

  it('produces DefaultImporterFolder YAML when isDir is true', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/MyFolder', true);
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('folderAsset: yes');
  });

  it('produces DefaultImporter YAML for a .png file (no folderAsset)', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/sprite.png');
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('DefaultImporter:');
    expect(result).not.toContain('folderAsset:');
  });

  it('throws for an invalid GUID', () => {
    expect(() => createMinimalMetaFor('not-a-guid', 'Assets/Foo.cs')).toThrow('not-a-guid');
  });

  it('throws for an uppercase GUID', () => {
    expect(() => createMinimalMetaFor('0123456789ABCDEF0123456789ABCDEF', 'Assets/Foo.cs')).toThrow(
      '0123456789ABCDEF0123456789ABCDEF',
    );
  });

  it('produces DefaultImporterFolder YAML for extensionless path (not LICENSE)', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/SomeFolder');
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('folderAsset: yes');
  });
});

// ---------------------------------------------------------------------------
// createMinimalFolderMeta
// ---------------------------------------------------------------------------

describe('createMinimalFolderMeta', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('produces folder meta YAML containing the guid', () => {
    const result = createMinimalFolderMeta(validGuid);
    expect(result).toContain(`guid: ${validGuid}`);
  });

  it('produces YAML with DefaultImporter block and folderAsset: yes', () => {
    const result = createMinimalFolderMeta(validGuid);
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('folderAsset: yes');
  });

  it('throws for an invalid GUID', () => {
    expect(() => createMinimalFolderMeta('bad')).toThrow('bad');
  });

  it('throws for an uppercase GUID', () => {
    expect(() => createMinimalFolderMeta('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  it('produces byte-stable output across two calls with the same GUID', () => {
    expect(createMinimalFolderMeta(validGuid)).toBe(createMinimalFolderMeta(validGuid));
  });
});

// ---------------------------------------------------------------------------
// createMinimalMeta backward compat
// ---------------------------------------------------------------------------

describe('createMinimalMeta backward compat', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('still works and produces DefaultImporter YAML', () => {
    const result = createMinimalMeta(validGuid);
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('DefaultImporter:');
    expect(result).not.toContain('folderAsset:');
    expect(result).not.toContain('MonoImporter:');
    expect(result).not.toContain('TextScriptImporter:');
  });
});
