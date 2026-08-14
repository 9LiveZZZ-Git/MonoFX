// Generates fixtures/salt-road.epub — a minimal, valid EPUB 3 (stored zip, no
// compression): mimetype + META-INF/container.xml + OPF + nav + two xhtml
// chapters. Run: node make-epub.mjs   (idempotent; commits the .epub next to it)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const files = [
  ['mimetype', 'application/epub+zip'],
  ['META-INF/container.xml',
`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`],
  ['OEBPS/content.opf',
`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:6f2a1c3e-salt-road</dc:identifier>
    <dc:title>The Salt Road</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`],
  ['OEBPS/nav.xhtml',
`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">Deadwater</a></li><li><a href="ch2.xhtml">Milepost</a></li></ol></nav></body></html>`],
  ['OEBPS/ch1.xhtml',
`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><h2>Deadwater</h2><p>The road tasted of salt and old iron for nine slow miles.</p></body></html>`],
  ['OEBPS/ch2.xhtml',
`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c2</title></head><body><h2>Milepost</h2><p>They walked it anyway, counting mile posts in the dark.</p></body></html>`],
];

// CRC-32 (IEEE), so the zip is valid for any external tool too.
const TBL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = TBL[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunks = [], central = [];
let offset = 0;
const u16 = v => Buffer.from([v & 255, (v >> 8) & 255]);
const u32 = v => Buffer.from([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);

for (const [name, text] of files) {
  const data = Buffer.from(text, 'utf8');
  const nameB = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0),
    nameB, data,
  ]);
  central.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length),
    u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
    nameB,
  ]));
  chunks.push(local);
  offset += local.length;
}
const cd = Buffer.concat(central);
const eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
  u32(cd.length), u32(offset), u16(0),
]);
const out = Buffer.concat([...chunks, cd, eocd]);
const dest = join(HERE, 'salt-road.epub');
writeFileSync(dest, out);
console.log('wrote', dest, out.length, 'bytes');
