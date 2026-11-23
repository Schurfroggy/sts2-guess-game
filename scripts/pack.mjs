import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

export function openPack(file) {
  const fd = openSync(file, 'r');
  const bytes = (start, size) => {
    const data = Buffer.alloc(size);
    if (readSync(fd, data, 0, size, start) !== size) throw Error('Unexpected end of PCK');
    return data;
  };
  try {
    const header = bytes(0, 112);
    if (header.toString('ascii', 0, 4) !== 'GDPC' || header.readUInt32LE(4) !== 3 || header.readUInt32LE(20) !== 2) {
      throw Error('Expected a Godot v3 PCK with non-encrypted index and relative file offsets');
    }
    const dataStart = Number(header.readBigUInt64LE(24));
    const indexStart = Number(header.readBigUInt64LE(32));
    const index = bytes(indexStart, fstatSync(fd).size - indexStart);
    const files = new Map();
    let cursor = 4;
    for (let item = 0; item < index.readUInt32LE(0); item++) {
      const length = index.readUInt32LE(cursor);
      cursor += 4;
      const name = index.toString('utf8', cursor, cursor + length).replace(/\0+$/, '');
      cursor += length;
      const start = dataStart + Number(index.readBigUInt64LE(cursor));
      const size = Number(index.readBigUInt64LE(cursor + 8));
      const flags = index.readUInt32LE(cursor + 32);
      cursor += 36;
      files.set(name, { start, size, flags });
    }
    if (cursor !== index.length) throw Error('Unexpected PCK index size');
    const read = (name) => {
      const entry = files.get(name);
      if (!entry || entry.flags !== 0) throw Error(`Missing or unsupported PCK resource: ${name}`);
      return bytes(entry.start, entry.size);
    };
    return {
      has: (name) => files.has(name) || files.has(name + '.import'),
      names: [...files.keys()],
      read,
      text: (name) => read(name).toString('utf8').replace(/\0+$/, ''),
      close: () => closeSync(fd)
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
