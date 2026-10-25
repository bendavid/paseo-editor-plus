import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

// Extracts a .zip archive: stored and deflated entries, Unix permissions when recorded. Enough
// for language server releases; no Zip64, encryption, or other compression methods.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEndOfCentralDirectory(zip: Buffer): number {
  const lowest = Math.max(0, zip.length - 22 - 0xffff);
  for (let offset = zip.length - 22; offset >= lowest; offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD) return offset;
  }
  throw new Error("Not a zip archive.");
}

/** The entry's path inside `root`, refusing absolute paths and `..`. */
function safePath(root: string, name: string): string {
  const relative = normalize(name.replace(/\\/g, "/"));
  if (isAbsolute(relative) || relative.split(sep).includes("..") || relative.startsWith("/")) {
    throw new Error(`Unsafe path in archive: ${name}`);
  }
  return join(root, relative);
}

export async function extractZip(zip: Buffer, root: string): Promise<number> {
  const end = findEndOfCentralDirectory(zip);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  if (offset === 0xffffffff) throw new Error("Zip64 archives are not supported.");
  let files = 0;
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== CENTRAL) throw new Error("Corrupt zip central directory.");
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const externalAttributes = zip.readUInt32LE(offset + 38);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if ([compressedSize, size, localOffset].includes(0xffffffff)) {
      throw new Error("Zip64 archives are not supported.");
    }
    const target = safePath(root, name);
    if (name.endsWith("/")) {
      await mkdir(target, { recursive: true });
      continue;
    }
    if (zip.readUInt32LE(localOffset) !== LOCAL) throw new Error("Corrupt zip entry.");
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    let content: Buffer;
    if (method === 0) content = data;
    else if (method === 8) content = inflateRawSync(data);
    else throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
    if (content.length !== size) throw new Error(`Size mismatch for ${name}.`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    // Unix permissions sit in the high bits of the external attributes when the archive was made
    // on Unix; keep the executable bits.
    const mode = (externalAttributes >>> 16) & 0o777;
    if (mode) await chmod(target, mode);
    files += 1;
  }
  return files;
}
