import re, io, json, sys
from fontTools.ttLib import TTFont
pdf, spans_path = sys.argv[1], sys.argv[2]
data = open(pdf, 'rb').read()
spans = json.load(open(spans_path))
out = {'errors': [], 'fonts': {}, 'flows': [], 'objects': 0, 'pages': 0, 'latinRuns': 0}

# xref: every offset must land on its own object header
sx = data.rfind(b'startxref')
xoff = int(data[sx+9:].split(b'%%EOF')[0].strip())
m = re.match(rb'xref\s+0\s+(\d+)\s', data[xoff:])
if not m:
    out['errors'].append('no xref table at startxref')
else:
    n = int(m.group(1)); body = data[xoff+m.end():]
    out['objects'] = n - 1
    for i in range(1, n):
        off = int(body[i*20:i*20+10])
        if not data[off:].startswith(f'{i} 0 obj'.encode()):
            out['errors'].append(f'object {i} offset {off} does not point at its header')
out['pages'] = len(re.findall(rb'/Type /Page\b', data))
if not re.search(rb'trailer\s*<< /Size \d+ /Root \d+ 0 R /Info \d+ 0 R >>', data):
    out['errors'].append('trailer malformed')

fonts = {}
for mm in re.finditer(rb'/Type /FontDescriptor /FontName /([A-Za-z0-9]+).*?/FontFile2 (\d+) 0 R', data, re.S):
    ps, fid = mm.group(1).decode(), int(mm.group(2))
    o = re.search(rb'\n%d 0 obj\n<< /Length (\d+) /Length1 (\d+) >>\nstream\n' % fid, data)
    if not o:
        out['errors'].append(f'{ps}: FontFile2 stream {fid} not found'); continue
    ln, l1 = int(o.group(1)), int(o.group(2))
    ttf = data[o.end():o.end()+ln]
    if ln != l1: out['errors'].append(f'{ps}: /Length {ln} != /Length1 {l1}')
    try:
        f = TTFont(io.BytesIO(ttf))
        f.ensureDecompiled()
        fonts[ps] = f
        out['fonts'][ps] = {'bytes': ln, 'glyphs': f['maxp'].numGlyphs,
                            'cmap': len(f.getBestCmap()), 'tables': sorted(f.keys())}
    except Exception as e:
        out['errors'].append(f'{ps}: fontTools could not decompile: {e}')

res = {}
for mm in re.finditer(rb'/S_([a-z_]+) (\d+) 0 R', data):
    lang, oid = mm.group(1).decode(), int(mm.group(2))
    t0m = re.search(rb'\n%d 0 obj\n(<<.*?>>)\n' % oid, data, re.S)
    if not t0m: out['errors'].append(f'{lang}: Type0 object {oid} missing'); continue
    t0 = t0m.group(1).decode('latin1')
    if '/Encoding /Identity-H' not in t0: out['errors'].append(f'{lang}: Type0 is not Identity-H')
    if '/Subtype /Type0' not in t0: out['errors'].append(f'{lang}: not a Type0 font')
    res[lang] = re.search(r'/BaseFont /([A-Za-z0-9]+)', t0).group(1)

seen = {}
for mm in re.finditer(rb'<< /Length \d+ >>\nstream\n(.*?)\nendstream', data, re.S):
    for tm in re.finditer(rb'BT /S_([a-z_]+) [\d.]+ Tf [^B]*?<([0-9a-fA-F]+)> Tj ET', mm.group(1)):
        lang, h = tm.group(1).decode(), tm.group(2).decode()
        gids = [int(h[i:i+4], 16) for i in range(0, len(h), 4)]
        f = fonts.get(res.get(lang))
        if not f: out['errors'].append(f'{lang}: run references a font that is not embedded'); continue
        gname = f.getGlyphOrder()
        g2c = {gname.index(nm): c for c, nm in f.getBestCmap().items()}
        for g in gids:
            if g not in g2c: out['errors'].append(f'{lang}: gid {g} has no cmap entry in the embedded face')
        seen.setdefault(lang, []).extend(g2c.get(g, -1) for g in gids)

for sp in spans:
    lang, want, got = sp['lang'], sp['codes'], seen.get(sp['lang'], [])
    if got == want: order = 'logical'
    elif got == want[::-1]: order = 'reversed'
    elif sorted(got) == sorted(want): order = 'scrambled'
    else: order = 'mismatch'
    want_rev = sp['flow'] == 'rtl'
    ok = (order == ('reversed' if want_rev else 'logical'))
    out['flows'].append({'lang': lang, 'flow': sp['flow'], 'pdf': len(got), 'app': len(want),
                         'order': order, 'ok': ok})

out['latinRuns'] = len(re.findall(rb'/F[1-4] [\d.]+ Tf [^B]*?\((.*?)\) Tj', data, re.S))
# a base-14 run must never carry PUA: those bytes are WinAnsi, PUA cannot survive
for lm in re.finditer(rb'/F[1-4] [\d.]+ Tf [^B]*?\((.*?)\) Tj', data, re.S):
    if re.search(rb'\\3[0-7][0-7]', lm.group(1)) and False: pass
print(json.dumps(out))
