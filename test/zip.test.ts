import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { test, describe } from 'node:test';
import { isZip, readEntries, readFirstEntry } from '../tools/zip.js';

/**
 * Builds a minimal, real ZIP archive in memory: local headers, central
 * directory, end-of-central-directory record. CRC32 is left at zero --
 * readEntryAt never checks it, so a real checksum would only pad this file
 * without exercising anything reflected in the reader.
 */
function buildZip(entries: Array<{ name: string; content: string; store?: boolean }>): Buffer {
  const parts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.content, 'utf8');
    const method = e.store ? 0 : 8;
    const data = e.store ? raw : deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(raw.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    const localOffset = offset;

    parts.push(local, nameBuf, data);
    offset += local.length + nameBuf.length + data.length;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuf);
  }

  const localSection = Buffer.concat(parts);
  const centralSection = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16); // central directory offset

  return Buffer.concat([localSection, centralSection, eocd]);
}

describe('zip reader', () => {
  test('isZip recognises the local-file-header signature', () => {
    assert.equal(isZip(buildZip([{ name: 'a.txt', content: 'x' }])), true);
    assert.equal(isZip(Buffer.from('not a zip at all')), false);
    assert.equal(isZip(Buffer.alloc(2)), false); // too short to even check
  });

  test('reads a single deflated entry', () => {
    const zip = buildZip([{ name: 'pmtiles.exe', content: 'fake binary content' }]);
    const entry = readFirstEntry(zip);
    assert.equal(entry.name, 'pmtiles.exe');
    assert.equal(entry.data.toString('utf8'), 'fake binary content');
  });

  test('reads a stored (uncompressed) entry', () => {
    const zip = buildZip([{ name: 'README.md', content: 'hello', store: true }]);
    const entry = readFirstEntry(zip);
    assert.equal(entry.data.toString('utf8'), 'hello');
  });

  test('readEntries reads every entry, not just the first, in order', () => {
    // Mirrors the real go-pmtiles release archive: LICENSE, README.md, then
    // the binary -- the one readEntries exists for, since readFirstEntry
    // alone cannot reach it.
    const zip = buildZip([
      { name: 'LICENSE', content: 'MIT', store: true },
      { name: 'README.md', content: 'readme text' },
      { name: 'pmtiles.exe', content: 'the actual binary' },
    ]);
    const entries = readEntries(zip);
    assert.deepEqual(
      entries.map((e) => e.name),
      ['LICENSE', 'README.md', 'pmtiles.exe'],
    );
    assert.equal(entries[2]?.data.toString('utf8'), 'the actual binary');
  });

  test('an unsupported compression method fails clearly', () => {
    const zip = buildZip([{ name: 'a.bin', content: 'x', store: true }]);
    // The reader takes the method from the central directory, not the local
    // header, so that's the field to corrupt -- located via the EOCD's own
    // "central directory offset" field, exactly as readEntryAt does it.
    const eocdOffset = zip.length - 22;
    const centralOffset = zip.readUInt32LE(eocdOffset + 16);
    zip.writeUInt16LE(99, centralOffset + 10);
    assert.throws(() => readEntries(zip), /compression method 99/);
  });

  test('an archive with no end-of-central-directory record is rejected', () => {
    assert.throws(() => readFirstEntry(Buffer.from('definitely not a zip')), /end-of-central-directory/);
  });
});
