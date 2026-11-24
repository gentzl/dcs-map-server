import { inflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP reader for Tacview recordings.
 *
 * Node ships no ZIP reader -- `node:zlib` handles deflate and gzip, but not
 * the container. Pulling in a library for this would be disproportionate:
 * the project otherwise has no runtime dependencies beyond Fastify, ws and
 * MapLibre, and Tacview archives contain exactly one entry in one of two
 * common methods.
 *
 * Read via the central directory, not the local file header: for
 * stream-written archives the sizes there are zero and only follow the data
 * in the data descriptor.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The end-of-central-directory record sits at the end, after a variable-length comment. */
function findEocd(buf: Buffer): number {
  const minOffset = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt16LE(0) === 0x4b50;
}

/** Reads the archive's first entry. A recording never needs more than that. */
export function readFirstEntry(buf: Buffer): ZipEntry {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('no end-of-central-directory record found');

  const entryCount = buf.readUInt16LE(eocd + 10);
  if (entryCount === 0) throw new Error('archive is empty');
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE) {
    throw new Error('central directory not readable');
  }

  const method = buf.readUInt16LE(centralOffset + 10);
  const compressedSize = buf.readUInt32LE(centralOffset + 20);
  const nameLength = buf.readUInt16LE(centralOffset + 28);
  const localOffset = buf.readUInt32LE(centralOffset + 42);
  const name = buf.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLength);

  if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    throw new Error('local file header not readable');
  }
  // The name and extra fields in the local header can differ from those in
  // the central directory, so they're read again here.
  const dataStart =
    localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
  const raw = buf.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return { name, data: raw };
  if (method === 8) return { name, data: inflateRawSync(raw) };
  throw new Error(`compression method ${method} is not supported`);
}
