// Minimal ZIP (store method, no compression)
// Creates a Blob containing a ZIP archive from provided files.

type ZipInput = { name: string; data: Uint8Array; date?: Date };

function dosDateTime(dt: Date) {
  const year = dt.getFullYear();
  const dosTime = ((dt.getHours() & 0x1f) << 11) | ((dt.getMinutes() & 0x3f) << 5) | ((Math.floor(dt.getSeconds() / 2)) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((dt.getMonth() + 1) & 0xf) << 5) | (dt.getDate() & 0x1f);
  return { dosTime, dosDate };
}

// CRC32 implementation
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let c = 0 ^ -1;
  for (let i = 0; i < data.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ data[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

function setUint32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}
function setUint16LE(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}

export async function makeZip(files: ZipInput[]): Promise<Blob> {
  const enc = new TextEncoder();
  const fileRecords: { nameBytes: Uint8Array; crc: number; size: number; offset: number; time: number; date: number; }[] = [];
  const parts: BlobPart[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name.replace(/\\/g, '/'));
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;
    const { dosDate, dosTime } = dosDateTime(f.date || new Date());

    // Local file header (30 bytes + name)
    const lh = new ArrayBuffer(30);
    const v = new DataView(lh);
    setUint32LE(v, 0, 0x04034b50);
    setUint16LE(v, 4, 20); // version needed
    setUint16LE(v, 6, 0);  // flags
    setUint16LE(v, 8, 0);  // method 0 (store)
    setUint16LE(v, 10, dosTime);
    setUint16LE(v, 12, dosDate);
    setUint32LE(v, 14, crc);
    setUint32LE(v, 18, size);
    setUint32LE(v, 22, size);
    setUint16LE(v, 26, nameBytes.length);
    setUint16LE(v, 28, 0); // extra length

    parts.push(new Uint8Array(lh));
    parts.push(nameBytes);
    parts.push(data);

    fileRecords.push({ nameBytes, crc, size, offset, time: dosTime, date: dosDate });
    offset += 30 + nameBytes.length + size;
  }

  const centralParts: BlobPart[] = [];
  let centralSize = 0;
  for (const r of fileRecords) {
    const ch = new ArrayBuffer(46);
    const v = new DataView(ch);
    setUint32LE(v, 0, 0x02014b50);
    setUint16LE(v, 4, 20); // version made by
    setUint16LE(v, 6, 20); // version needed
    setUint16LE(v, 8, 0);  // flags
    setUint16LE(v, 10, 0); // method
    setUint16LE(v, 12, r.time);
    setUint16LE(v, 14, r.date);
    setUint32LE(v, 16, r.crc);
    setUint32LE(v, 20, r.size);
    setUint32LE(v, 24, r.size);
    setUint16LE(v, 28, r.nameBytes.length);
    setUint16LE(v, 30, 0); // extra len
    setUint16LE(v, 32, 0); // comment len
    setUint16LE(v, 34, 0); // disk start
    setUint16LE(v, 36, 0); // internal attrs
    setUint32LE(v, 38, 0); // external attrs
    setUint32LE(v, 42, r.offset);

    centralParts.push(new Uint8Array(ch));
    centralParts.push(r.nameBytes);
    centralSize += 46 + r.nameBytes.length;
  }

  const end = new ArrayBuffer(22);
  const ev = new DataView(end);
  setUint32LE(ev, 0, 0x06054b50);
  setUint16LE(ev, 4, 0); // disk number
  setUint16LE(ev, 6, 0); // start disk
  setUint16LE(ev, 8, fileRecords.length);
  setUint16LE(ev, 10, fileRecords.length);
  setUint32LE(ev, 12, centralSize);
  setUint32LE(ev, 16, offset);
  setUint16LE(ev, 20, 0); // comment len

  return new Blob([...parts, ...centralParts, new Uint8Array(end)], { type: 'application/zip' });
}

