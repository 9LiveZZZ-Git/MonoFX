# Deeper PDF validator for the TX-10b gap probes.
#
# _pdfcheck.py proves the happy path. This one is written for the hostile book:
# it tokenises the content streams properly (a literal string may legally
# contain "ET", "(" or "Tj"), resolves the object graph, checks every declared
# /Length against the bytes actually written, and checks every glyph id the page
# asks for against the embedded face's numGlyphs AND its cmap. It also reports
# every mark placed outside the MediaBox / the 1in margin so a layout overflow
# cannot hide behind a structurally valid file.
#
#   python3 cf-pdfcheck2.py book.pdf spans.json
import re, io, json, sys
from fontTools.ttLib import TTFont

pdf_path, spans_path = sys.argv[1], sys.argv[2]
data = open(pdf_path, 'rb').read()
spans = json.load(open(spans_path)) if spans_path != '-' else []
out = {'errors': [], 'warn': [], 'fonts': {}, 'flows': [], 'objects': 0, 'pages': 0,
       'latinRuns': 0, 'scriptRuns': 0, 'emptyPages': 0, 'outside': [], 'qmarks': 0,
       'pageOps': [], 'gidsPerLang': {}, 'toUnicode': 0, 'maxLatinX': 0, 'overrun': []}
err = out['errors'].append
warn = out['warn'].append

if not data.startswith(b'%PDF-1.7\n'): err('bad header: ' + repr(data[:12]))
if not data.rstrip().endswith(b'%%EOF'): err('no %%EOF at end')

# ---------- xref / trailer / object graph ----------
sx = data.rfind(b'startxref')
xoff = int(data[sx+9:].split(b'%%EOF')[0].strip())
m = re.match(rb'xref\s+0\s+(\d+)\s', data[xoff:])
offsets = {}
if not m:
    err('no xref table at startxref')
else:
    n = int(m.group(1)); body = data[xoff+m.end():]
    out['objects'] = n - 1
    if body[0:20] != b'0000000000 65535 f \n': err('free-list head entry malformed: ' + repr(body[0:20]))
    for i in range(1, n):
        ent = body[i*20:i*20+20]
        if len(ent) != 20 or not re.match(rb'\d{10} 00000 n \n', ent):
            err(f'xref entry {i} is not a 20-byte in-use entry: {ent!r}'); continue
        off = int(ent[:10]); offsets[i] = off
        if not data[off:].startswith(f'{i} 0 obj'.encode()):
            err(f'object {i} offset {off} does not point at its header')

tm = re.search(rb'trailer\s*<< /Size (\d+) /Root (\d+) 0 R /Info (\d+) 0 R >>', data)
if not tm: err('trailer malformed')
else:
    size, root, info = int(tm.group(1)), int(tm.group(2)), int(tm.group(3))
    if size != out['objects'] + 1: err(f'/Size {size} != objects+1 {out["objects"]+1}')
    for nm, oid in (('Root', root), ('Info', info)):
        if oid not in offsets: err(f'/{nm} {oid} is not in the xref')

def obj_body(i):
    if i not in offsets: return None
    s = data.index(b'obj', offsets[i]) + 3
    e = data.index(b'endobj', s)
    return data[s:e]

# catalog -> pages -> kids
cat = None
for i in offsets:
    b = obj_body(i)
    if b and b'/Type /Catalog' in b: cat = (i, b)
if not cat: err('no /Type /Catalog object')
else:
    pid = int(re.search(rb'/Pages (\d+) 0 R', cat[1]).group(1))
    pb = obj_body(pid)
    if not pb or b'/Type /Pages' not in pb: err('/Pages does not resolve to a /Type /Pages object')
    else:
        kids = [int(x) for x in re.findall(rb'(\d+) 0 R', pb)]
        cnt = int(re.search(rb'/Count (\d+)', pb).group(1))
        if cnt != len(kids): err(f'/Count {cnt} != {len(kids)} kids')
        out['pages'] = len(kids)
        for k in kids:
            kb = obj_body(k)
            if not kb or b'/Type /Page' not in kb: err(f'kid {k} is not a /Type /Page'); continue
            par = int(re.search(rb'/Parent (\d+) 0 R', kb).group(1))
            if par != pid: err(f'page {k} /Parent {par} != {pid}')

# ---------- streams: declared /Length vs bytes actually written ----------
streams = []   # (objnum, dict, payload)
for i in sorted(offsets):
    b = obj_body(i)
    if not b or b'stream' not in b: continue
    sm = re.search(rb'stream\r?\n', b)
    if not sm: continue
    d = b[:sm.start()]
    payload = b[sm.end():]
    if not payload.endswith(b'\nendstream\n'): err(f'object {i}: stream does not end with \\nendstream')
    payload = payload[:-len(b'\nendstream\n')]
    L = int(re.search(rb'/Length (\d+)', d).group(1))
    if L != len(payload): err(f'object {i}: /Length {L} but {len(payload)} bytes written')
    streams.append((i, d.decode('latin1'), payload))

# ---------- fonts ----------
fonts = {}      # psname -> TTFont
fontfile_obj = {}
for mm in re.finditer(rb'/Type /FontDescriptor /FontName /([A-Za-z0-9]+).*?/FontFile2 (\d+) 0 R', data, re.S):
    ps, fid = mm.group(1).decode(), int(mm.group(2))
    st = [s for s in streams if s[0] == fid]
    if not st: err(f'{ps}: FontFile2 stream {fid} not found'); continue
    d, ttf = st[0][1], st[0][2]
    l1 = int(re.search(r'/Length1 (\d+)', d).group(1))
    if l1 != len(ttf): err(f'{ps}: /Length1 {l1} != {len(ttf)} font bytes')
    try:
        f = TTFont(io.BytesIO(ttf)); f.ensureDecompiled()
        fonts[ps] = f
        out['fonts'][ps] = {'bytes': len(ttf), 'glyphs': f['maxp'].numGlyphs,
                            'cmap': len(f.getBestCmap()), 'tables': sorted(f.keys())}
    except Exception as e:
        err(f'{ps}: fontTools could not decompile: {e}')

# Type0 + descendant checks
res = {}        # lang -> psname
for mm in re.finditer(rb'/S_([a-z_]+) (\d+) 0 R', data):
    lang, oid = mm.group(1).decode(), int(mm.group(2))
    if lang in res: continue
    t0 = (obj_body(oid) or b'').decode('latin1')
    if '/Subtype /Type0' not in t0: err(f'{lang}: object {oid} is not a Type0 font')
    if '/Encoding /Identity-H' not in t0: err(f'{lang}: Type0 is not Identity-H')
    if '/ToUnicode' in t0: out['toUnicode'] += 1
    bf = re.search(r'/BaseFont /([A-Za-z0-9]+)', t0)
    res[lang] = bf.group(1) if bf else None
    dm = re.search(r'/DescendantFonts \[(\d+) 0 R\]', t0)
    if not dm: err(f'{lang}: no DescendantFonts array'); continue
    cid = (obj_body(int(dm.group(1))) or b'').decode('latin1')
    if '/Subtype /CIDFontType2' not in cid: err(f'{lang}: descendant is not CIDFontType2')
    if '/CIDToGIDMap /Identity' not in cid: err(f'{lang}: CIDToGIDMap is not /Identity')
    if '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>' not in cid:
        err(f'{lang}: CIDSystemInfo malformed')
    wm = re.search(r'/W \[(.*?)\] /CIDToGIDMap', cid, re.S)
    if not wm: err(f'{lang}: no /W array')
    else:
        pairs = re.findall(r'(\d+) \[(-?\d+)\]', wm.group(1))
        if len(pairs) * 1 == 0: err(f'{lang}: /W array is empty')
        ng = out['fonts'].get(res[lang], {}).get('glyphs', 0)
        for g, w in pairs:
            if int(g) >= ng: err(f'{lang}: /W names gid {g} but the face has {ng} glyphs')
        gs = [int(g) for g, _ in pairs]
        if gs != sorted(gs): err(f'{lang}: /W array is not gid-ordered')

# ---------- content-stream tokeniser ----------
def tokens(buf):
    i, n = 0, len(buf)
    while i < n:
        c = buf[i:i+1]
        if c in b' \r\n\t': i += 1; continue
        if c == b'(':
            j, depth, s = i+1, 1, bytearray()
            while j < n and depth:
                ch = buf[j:j+1]
                if ch == b'\\': s += buf[j:j+2]; j += 2; continue
                if ch == b'(': depth += 1
                elif ch == b')':
                    depth -= 1
                    if not depth: j += 1; break
                s += ch; j += 1
            yield ('str', bytes(s)); i = j; continue
        if c == b'<':
            j = buf.index(b'>', i)
            yield ('hex', buf[i+1:j].decode('latin1')); i = j+1; continue
        if c == b'/':
            j = i+1
            while j < n and buf[j:j+1] not in b' \r\n\t/([<': j += 1
            yield ('name', buf[i+1:j].decode('latin1')); i = j; continue
        j = i
        while j < n and buf[j:j+1] not in b' \r\n\t/([<': j += 1
        w = buf[i:j].decode('latin1'); i = j
        try: yield ('num', float(w))
        except ValueError: yield ('op', w)

MEDIA = (0, 0, 595.28, 841.89); MARGIN = 72.0
seen = {}     # lang -> [codepoints in draw order]
for (oid, d, payload) in streams:
    if b'FontFile2' in d.encode() or '/Length1' in d: continue
    if not re.match(r'<< /Length \d+ >>$', d.strip()): continue
    ops = 0; cur_font = None; cur_size = None; x = y = None; pending = None
    stack = []
    for kind, val in tokens(payload):
        if kind == 'op':
            ops += 1
            if val == 'Tf' and len(stack) >= 2:
                cur_font, cur_size = stack[-2][1], stack[-1][1]
            elif val == 'Tm' and len(stack) >= 6:
                x, y = stack[-2][1], stack[-1][1]
            elif val == 'Tj' and stack:
                k, v = stack[-1]
                if x is None or not (MEDIA[0] <= x <= MEDIA[2] and MEDIA[1] <= y <= MEDIA[3]):
                    out['outside'].append({'obj': oid, 'font': cur_font, 'x': x, 'y': y, 'kind': 'offpage'})
                elif not (MARGIN - 1 <= x and y >= MARGIN - 1 and y <= MEDIA[3] - MARGIN + 20):
                    out['outside'].append({'obj': oid, 'font': cur_font, 'x': x, 'y': y, 'kind': 'margin'})
                if k == 'str':
                    out['latinRuns'] += 1
                    if x is not None and x > out['maxLatinX']: out['maxLatinX'] = round(x, 2)
                    out['qmarks'] += v.count(b'?')
                    if cur_font and cur_font.startswith('S_'): err(f'script font {cur_font} used with a literal string')
                    for oct_ in re.findall(rb'\\([0-7]{3})', v):
                        if int(oct_, 8) < 32: err(f'control byte in a base-14 run: {oct_}')
                elif k == 'hex':
                    out['scriptRuns'] += 1
                    lang = cur_font[2:] if cur_font and cur_font.startswith('S_') else None
                    if lang is None: err(f'hex string drawn with base-14 font {cur_font}'); continue
                    if len(v) % 4: err(f'{lang}: hex string length {len(v)} is not a multiple of 4')
                    gids = [int(v[i:i+4], 16) for i in range(0, len(v), 4)]
                    out['gidsPerLang'].setdefault(lang, []).extend(gids)
                    ps = res.get(lang)
                    f = fonts.get(ps)
                    if not f: err(f'{lang}: run references a font that is not embedded'); continue
                    order = f.getGlyphOrder()
                    cmap = f.getBestCmap()
                    g2c = {order.index(nm): c for c, nm in cmap.items()}
                    ng = f['maxp'].numGlyphs
                    for g in gids:
                        if g >= ng: err(f'{lang}: gid {g} >= numGlyphs {ng}')
                        elif g not in g2c: err(f'{lang}: gid {g} has no cmap entry in the embedded face')
                        elif g == 0: err(f'{lang}: .notdef (gid 0) written into the page')
                    seen.setdefault(lang, []).extend(g2c.get(g, -1) for g in gids)
                    hm = f['hmtx'].metrics
                    upem = f['head'].unitsPerEm
                    adv = sum(hm[order[g]][0] for g in gids if g < ng) / upem * (cur_size or 0)
                    if x is not None and x + adv > MEDIA[2] - MARGIN + 1:
                        out['overrun'].append({'obj': oid, 'font': cur_font, 'x': round(x, 2),
                                               'right': round(x + adv, 2), 'y': round(y, 2)})
            stack = []
        else:
            stack.append((kind, val))
    out['pageOps'].append(ops)
    if ops == 0: out['emptyPages'] += 1

# ---------- what the app shows vs what the page carries ----------
for sp in spans:
    lang, want = sp['lang'], sp['codes']
    got = seen.get(lang, [])
    if got == want: order = 'logical'
    elif got == want[::-1]: order = 'reversed'
    elif sorted(got) == sorted(want): order = 'scrambled'
    else: order = 'mismatch'
    want_rev = sp['flow'] == 'rtl'
    out['flows'].append({'lang': lang, 'flow': sp['flow'], 'pdf': len(got), 'app': len(want),
                         'order': order, 'ok': order == ('reversed' if want_rev else 'logical')})
print(json.dumps(out))
