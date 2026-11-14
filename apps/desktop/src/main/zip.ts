/** A small ZIP writer (deflate), enough to pack a folder of text files: no dependency needed. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Every file under `dir` (not dot-files or dot-folders), as paths relative to it with `/`, in name order. */
export function listFiles(dir: string, sub = ''): string[] {
  const out: string[] = [];
  const ents = fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** The bytes of a ZIP archive holding these files. `prefix` is a folder name that everything is put inside. */
export function zipFiles(files: Array<{ name: string; data: Uint8Array }>, prefix = '', when = new Date()): Buffer {
  const dosTime = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(prefix ? `${prefix}/${f.name}` : f.name, 'utf8');
    const raw = Buffer.from(f.data);
    const packed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime, 12);
    c.writeUInt16LE(dosDate, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}

/** A ZIP of the Markdown files of a folder (the documentation), inside a folder called `prefix`. */
export function zipFolder(dir: string, prefix: string): Buffer {
  return zipFiles(listFiles(dir).map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) })), prefix);
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Read a ZIP archive held in memory (stored or deflated entries). Folders are not listed; a name with `..`, a drive or a leading slash is an error. */
export function readZip(buf: Buffer, limits = { entries: 2000, bytes: 100 * 1024 * 1024 }): ZipEntry[] {
  // the end-of-central-directory record is in the last 64 KB
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This is not a zip file.');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  if (count > limits.entries) throw new Error(`The zip holds too many files (${count}).`);
  const out: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x0800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // a folder
    if (/^([a-zA-Z]:|\/|\\)/.test(name) || name.split(/[\\/]/).includes('..')) throw new Error(`The zip has an unsafe path: ${name}`);
    if (name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(name)) continue;
    if (flags & 1) throw new Error('A zip that needs a password cannot be read.');
    total += usize;
    if (total > limits.bytes) throw new Error('The zip is too large.');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('The zip file is damaged.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) + 1024 });
    else throw new Error(`The zip uses a compression method (${method}) that cannot be read.`);
    out.push({ name: name.replace(/\\/g, '/'), data });
  }
  return out;
}
