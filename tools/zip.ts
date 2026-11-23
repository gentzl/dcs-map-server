import { inflateRawSync } from 'node:zlib';

/**
 * Minimaler ZIP-Leser für Tacview-Aufzeichnungen.
 *
 * Node bringt keinen ZIP-Leser mit -- `node:zlib` beherrscht Deflate und Gzip,
 * aber nicht den Container. Eine Bibliothek dafür aufzunehmen wäre
 * unverhältnismäßig: Das Projekt kommt sonst ohne Laufzeitabhängigkeiten
 * jenseits von Fastify, ws und MapLibre aus, und Tacview-Archive enthalten
 * genau einen Eintrag in einem der zwei gängigen Verfahren.
 *
 * Gelesen wird über das Central Directory, nicht über den Local File Header:
 * Bei strömend geschriebenen Archiven stehen die Größen dort auf null und
 * folgen erst hinter den Daten im Data Descriptor.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Das End-of-Central-Directory steht am Ende, hinter einem Kommentar variabler Länge. */
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

/** Liest den ersten Eintrag des Archivs. Mehr braucht eine Aufzeichnung nicht. */
export function readFirstEntry(buf: Buffer): ZipEntry {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('kein End-of-Central-Directory gefunden');

  const entryCount = buf.readUInt16LE(eocd + 10);
  if (entryCount === 0) throw new Error('Archiv ist leer');
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE) {
    throw new Error('Central Directory nicht lesbar');
  }

  const method = buf.readUInt16LE(centralOffset + 10);
  const compressedSize = buf.readUInt32LE(centralOffset + 20);
  const nameLength = buf.readUInt16LE(centralOffset + 28);
  const localOffset = buf.readUInt32LE(centralOffset + 42);
  const name = buf.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLength);

  if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    throw new Error('Local File Header nicht lesbar');
  }
  // Namens- und Extra-Feld im lokalen Header können von denen im Central
  // Directory abweichen, deshalb hier erneut lesen.
  const dataStart =
    localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
  const raw = buf.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return { name, data: raw };
  if (method === 8) return { name, data: inflateRawSync(raw) };
  throw new Error(`Kompressionsverfahren ${method} wird nicht unterstuetzt`);
}
