/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createMinimalMetaFor,
  readDeclaredMetaImporter,
  readMetaGuid,
  writeMetaGuid,
} from './index';

const textureMeta = new URL('../../../fixtures/static/texture.png.meta', import.meta.url);



describe('meta inspection', () => {
  it('reads the GUID from a real TextureImporter meta fixture', () => {
    const meta = readFileSync(textureMeta);

    expect(readMetaGuid(meta)).toBe('b2164c38ac6d28c478b53462658238f8');
  });

  it('reports TextureImporter as an unknown declared importer', () => {
    const meta = readFileSync(textureMeta);

    expect(readDeclaredMetaImporter(meta)).toEqual({ kind: 'unknown', name: 'TextureImporter' });
  });

  it('recognizes folderAsset as the folder importer variant', () => {
    const meta = 'fileFormatVersion: 2\nguid: 0123456789abcdef0123456789abcdef\nDefaultImporter:\nfolderAsset: yes\n';

    expect(readDeclaredMetaImporter(meta)).toEqual({ kind: 'known', type: 'DefaultImporterFolder' });
  });
});

// ---------------------------------------------------------------------------
// createMinimalMetaFor
// ---------------------------------------------------------------------------

// createMinimalMetaFor calls detectMetaImporterType (private) internally,
// so these tests exercise that path via createMinimalMetaFor.

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

  it('accepts and lowercases an uppercase GUID', () => {
    const result = createMinimalMetaFor('0123456789ABCDEF0123456789ABCDEF', 'Assets/Foo.cs');
    expect(result).toContain('guid: 0123456789abcdef0123456789abcdef');
  });

  it('produces DefaultImporterFolder YAML for extensionless path (not LICENSE)', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/SomeFolder');
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('folderAsset: yes');
  });
});



// ---------------------------------------------------------------------------
// writeMetaGuid
// ---------------------------------------------------------------------------

describe('writeMetaGuid', () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const validGuid = 'abcdef0123456789abcdef0123456789';

  it('updates the GUID line in normal meta contents', () => {
    const originalText = 'fileFormatVersion: 2\nguid: 00000000000000000000000000000000\nDefaultImporter:\n';
    const bytes = encoder.encode(originalText);
    const updatedBytes = writeMetaGuid(bytes, validGuid);
    const updatedText = decoder.decode(updatedBytes);

    expect(updatedText).toBe('fileFormatVersion: 2\nguid: abcdef0123456789abcdef0123456789\nDefaultImporter:\n');
  });

  it('prepends guid line if no guid line exists in the original meta', () => {
    const originalText = 'fileFormatVersion: 2\nDefaultImporter:\n';
    const bytes = encoder.encode(originalText);
    const updatedBytes = writeMetaGuid(bytes, validGuid);
    const updatedText = decoder.decode(updatedBytes);

    expect(updatedText).toBe('guid: abcdef0123456789abcdef0123456789\nfileFormatVersion: 2\nDefaultImporter:\n');
  });

  it('preserves indentation of the original guid line', () => {
    const originalText = 'fileFormatVersion: 2\n  guid: 00000000000000000000000000000000\nDefaultImporter:\n';
    const bytes = encoder.encode(originalText);
    const updatedBytes = writeMetaGuid(bytes, validGuid);
    const updatedText = decoder.decode(updatedBytes);

    expect(updatedText).toBe('fileFormatVersion: 2\n  guid: abcdef0123456789abcdef0123456789\nDefaultImporter:\n');
  });

  it('preserves CR line endings for updated guid line', () => {
    const originalText = 'fileFormatVersion: 2\r\nguid: 00000000000000000000000000000000\r\nDefaultImporter:\r\n';
    const bytes = encoder.encode(originalText);
    const updatedBytes = writeMetaGuid(bytes, validGuid);
    const updatedText = decoder.decode(updatedBytes);

    expect(updatedText).toBe('fileFormatVersion: 2\r\nguid: abcdef0123456789abcdef0123456789\r\nDefaultImporter:\r\n');
  });

  it('accepts and lowercases an uppercase GUID', () => {
    const originalText = 'fileFormatVersion: 2\nguid: 00000000000000000000000000000000\nDefaultImporter:\n';
    const bytes = encoder.encode(originalText);
    const updatedBytes = writeMetaGuid(bytes, 'ABCDEF0123456789ABCDEF0123456789');
    const updatedText = decoder.decode(updatedBytes);
    expect(updatedText).toBe('fileFormatVersion: 2\nguid: abcdef0123456789abcdef0123456789\nDefaultImporter:\n');
  });

  it('throws for an invalid GUID', () => {
    const originalText = 'fileFormatVersion: 2\nguid: 00000000000000000000000000000000\nDefaultImporter:\n';
    const bytes = encoder.encode(originalText);
    expect(() => writeMetaGuid(bytes, 'not-a-guid')).toThrow();
  });
});

