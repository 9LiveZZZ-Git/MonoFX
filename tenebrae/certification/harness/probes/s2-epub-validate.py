#!/usr/bin/env python3
"""Strict EPUB validator for the Tenebrae step-2 certification (X2-6..X2-9).

Usage: python3 s2-epub-validate.py <file.epub>
Prints a JSON report to stdout:
  {
    "errors": [...],              # any structural/parse/coverage failure
    "title": "...",               # dc:title text (entity-decoded)
    "language": "...", "identifier": "...", "modified": "...",
    "nav": ["chapter title", ...],
    "chapters": { "ch1.xhtml": {"h1": [...], "h2": [...], "h3": [...], "h4": [...],
                                 "ast": N, "tspans": [{lang,src,rom,dir,flow,text,puaCount}...] } },
    "fonts": [{"file","family","numGlyphs","codepoints":N}...],
    "css": {"unicodeBidi": bool, "smallCaps": bool, "tspanRule": bool,
             "langFamilies": {lang: family}},
    "coverage": [{"lang","family","missing":[...]} ...]   # per distinct span lang
  }
All XML parts are parsed with xml.dom.minidom (strict; no tag soup).
Fonts are parsed with fontTools (real TTF parse, cmap extracted).
"""
import sys, json, re, zipfile, io, posixpath
from xml.dom import minidom

report = {"errors": [], "title": None, "language": None, "identifier": None,
          "modified": None, "nav": [], "chapters": {}, "fonts": [], "css": {},
          "coverage": [], "spine": [], "manifest": []}
err = report["errors"].append

path = sys.argv[1]
raw = open(path, "rb").read()

# ---- container-level: mimetype must be FIRST local entry, stored, exact ----
if raw[0:4] != b"PK\x03\x04":
    err("first bytes are not a local file header")
else:
    name_len = int.from_bytes(raw[26:28], "little")
    extra_len = int.from_bytes(raw[28:30], "little")
    method = int.from_bytes(raw[8:10], "little")
    first_name = raw[30:30 + name_len].decode("utf-8")
    if first_name != "mimetype":
        err(f"first entry is {first_name!r}, not mimetype")
    if method != 0:
        err("mimetype entry is compressed, must be stored")
    if extra_len != 0:
        err("mimetype entry carries an extra field")
    csize = int.from_bytes(raw[18:22], "little")
    body = raw[30 + name_len + extra_len:30 + name_len + extra_len + csize]
    if body != b"application/epub+zip":
        err(f"mimetype content wrong: {body!r}")

try:
    zf = zipfile.ZipFile(io.BytesIO(raw))
except Exception as e:
    err(f"zip does not open: {e}")
    print(json.dumps(report)); sys.exit(0)
bad = zf.testzip()
if bad is not None:
    err(f"zip CRC failure on {bad}")
names = zf.namelist()

def parse_xml(name):
    try:
        return minidom.parseString(zf.read(name))
    except Exception as e:
        err(f"strict XML parse failed for {name}: {e}")
        return None

# ---- container.xml -> OPF ----
opf_path = None
if "META-INF/container.xml" not in names:
    err("META-INF/container.xml missing")
else:
    cont = parse_xml("META-INF/container.xml")
    if cont:
        rf = cont.getElementsByTagName("rootfile")
        if not rf:
            err("container.xml has no rootfile")
        else:
            opf_path = rf[0].getAttribute("full-path")
            if opf_path not in names:
                err(f"container points at {opf_path} which is not in the zip")
                opf_path = None

manifest = {}
spine = []
opf_dir = ""
if opf_path:
    opf_dir = posixpath.dirname(opf_path)
    opf = parse_xml(opf_path)
    if opf:
        def dctext(local):
            for el in opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", local):
                return "".join(n.data for n in el.childNodes if n.nodeType == n.TEXT_NODE)
            return None
        report["identifier"] = dctext("identifier")
        report["title"] = dctext("title")
        report["language"] = dctext("language")
        for m in opf.getElementsByTagName("meta"):
            if m.getAttribute("property") == "dcterms:modified":
                report["modified"] = "".join(n.data for n in m.childNodes if n.nodeType == n.TEXT_NODE)
        for need, val in [("dc:identifier", report["identifier"]), ("dc:title", report["title"]),
                          ("dc:language", report["language"]), ("dcterms:modified", report["modified"])]:
            if not val:
                err(f"OPF missing {need}")
        if report["modified"] and not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", report["modified"]):
            err(f"dcterms:modified not CCYY-MM-DDThh:mm:ssZ: {report['modified']}")
        for it in opf.getElementsByTagName("item"):
            manifest[it.getAttribute("id")] = {
                "href": it.getAttribute("href"),
                "type": it.getAttribute("media-type"),
                "props": it.getAttribute("properties"),
            }
        report["manifest"] = [dict(id=k, **v) for k, v in manifest.items()]
        for ref in opf.getElementsByTagName("itemref"):
            spine.append(ref.getAttribute("idref"))
        report["spine"] = spine
        if not spine:
            err("spine is empty")
        # every itemref must resolve; every manifested href must exist in the zip
        for idref in spine:
            if idref not in manifest:
                err(f"dangling spine itemref: {idref}")
        for mid, it in manifest.items():
            full = posixpath.normpath(posixpath.join(opf_dir, it["href"]))
            if full not in names:
                err(f"manifest item {mid} -> {it['href']} not in zip")
        if not any("nav" in it["props"].split() for it in manifest.values()):
            err("no manifest item with properties=nav")
        # every zip entry except mimetype/container/opf must be manifested (no strays)
        manifested = {posixpath.normpath(posixpath.join(opf_dir, it["href"])) for it in manifest.values()}
        for n in names:
            if n in ("mimetype", "META-INF/container.xml", opf_path):
                continue
            if n.endswith("/"):
                continue
            if n not in manifested:
                err(f"zip entry not manifested: {n}")

# ---- CSS ----
css_map, faces = {}, {}
css_text = ""
css_items = [it for it in manifest.values() if it["type"] == "text/css"]
if not css_items:
    err("no stylesheet manifested")
else:
    css_text = zf.read(posixpath.normpath(posixpath.join(opf_dir, css_items[0]["href"]))).decode("utf-8")
    for m in re.finditer(r"@font-face\{font-family:'([^']+)';src:url\('([^']+)'\)", css_text):
        faces[m.group(1)] = posixpath.normpath(posixpath.join(opf_dir, m.group(2)))
    for m in re.finditer(r"\.tspan\[data-lang=\"([^\"]+)\"\]\{font-family:'([^']+)'", css_text):
        css_map[m.group(1)] = m.group(2)
report["css"] = {
    "unicodeBidi": bool(re.search(r"\.tspan\[dir=\"rtl\"\]\{[^}]*unicode-bidi\s*:\s*isolate", css_text)),
    "smallCaps": bool(re.search(r"\.sc\{[^}]*font-variant\s*:\s*small-caps", css_text)),
    "tspanRule": ".tspan{" in css_text,
    "colsRtl": bool(re.search(r"\.tspan\[data-flow=\"cols-rtl\"\]\{[^}]*writing-mode\s*:\s*vertical-rl", css_text)),
    "bttStave": bool(re.search(r"\.tspan\[data-flow=\"btt-stave\"\]\{[^}]*writing-mode\s*:\s*vertical-lr", css_text)),
    "langFamilies": css_map,
    "faces": {k: v for k, v in faces.items()},
}

# ---- fonts: every embedded ttf parses, is manifested font/ttf, has an @font-face ----
font_cmaps = {}
ttf_entries = [n for n in names if n.lower().endswith(".ttf")]
for n in ttf_entries:
    it = next((i for i in manifest.values()
               if posixpath.normpath(posixpath.join(opf_dir, i["href"])) == n), None)
    if it is None:
        err(f"embedded font {n} not manifested")
    elif it["type"] != "font/ttf":
        err(f"font {n} manifested as {it['type']!r}, expected font/ttf")
    try:
        from fontTools.ttLib import TTFont
        f = TTFont(io.BytesIO(zf.read(n)))
        cmap = f.getBestCmap()
        fam = ""
        for rec in f["name"].names:
            if rec.nameID == 1:
                fam = rec.toUnicode()
                break
        font_cmaps[n] = {"family": fam, "codes": set(cmap.keys())}
        report["fonts"].append({"file": n, "family": fam,
                                "numGlyphs": f["maxp"].numGlyphs,
                                "codepoints": len(cmap)})
        if fam and fam not in faces:
            err(f"font {n} (family {fam!r}) has no @font-face rule")
        elif fam and faces.get(fam) != n:
            err(f"@font-face for {fam!r} points at {faces.get(fam)}, font lives at {n}")
    except Exception as e:
        err(f"fontTools failed to parse {n}: {e}")
for fam, href in faces.items():
    if href not in names:
        err(f"@font-face {fam!r} references missing file {href}")

# ---- XHTML content: strict parse + structure + tspans ----
XH = "http://www.w3.org/1999/xhtml"
def text_of(el):
    out = []
    for n in el.childNodes:
        if n.nodeType == n.TEXT_NODE:
            out.append(n.data)
        elif n.nodeType == n.ELEMENT_NODE:
            out.append(text_of(n))
    return "".join(out)

pua = lambda s: [c for c in s if 0xE000 <= ord(c) <= 0xF8FF]

for mid, it in manifest.items():
    if it["type"] != "application/xhtml+xml":
        continue
    full = posixpath.normpath(posixpath.join(opf_dir, it["href"]))
    doc = parse_xml(full)
    if doc is None:
        continue
    if doc.documentElement.namespaceURI != XH:
        err(f"{full}: root element not in the XHTML namespace")
    if "nav" in it["props"].split():
        navs = [n for n in doc.getElementsByTagNameNS(XH, "nav")
                if n.getAttributeNS("http://www.idpf.org/2007/ops", "type") == "toc"
                or n.getAttribute("epub:type") == "toc"]
        if not navs:
            err(f"{full}: no nav with epub:type=toc")
        else:
            for a in navs[0].getElementsByTagNameNS(XH, "a"):
                report["nav"].append({"href": a.getAttribute("href"), "text": text_of(a)})
        continue
    info = {"h1": [], "h2": [], "h3": [], "h4": [], "ast": 0, "tspans": [],
            "stylesheetLinked": False}
    for ln in doc.getElementsByTagNameNS(XH, "link"):
        if ln.getAttribute("rel") == "stylesheet":
            info["stylesheetLinked"] = True
    if not info["stylesheetLinked"]:
        err(f"{full}: stylesheet not linked")
    for h in ("h1", "h2", "h3", "h4"):
        for el in doc.getElementsByTagNameNS(XH, h):
            info[h].append(text_of(el))
    for p in doc.getElementsByTagNameNS(XH, "p"):
        if p.getAttribute("class") == "ast":
            info["ast"] += 1
            if text_of(p) != "⁂":
                err(f"{full}: ast paragraph text is {text_of(p)!r}")
    for sp in doc.getElementsByTagNameNS(XH, "span"):
        if sp.getAttribute("class") != "tspan":
            continue
        t = text_of(sp)
        info["tspans"].append({
            "lang": sp.getAttribute("data-lang"), "src": sp.getAttribute("data-src"),
            "rom": sp.getAttribute("data-rom"), "dir": sp.getAttribute("dir"),
            "flow": sp.getAttribute("data-flow"), "text": t, "puaCount": len(pua(t)),
        })
    report["chapters"][posixpath.basename(full)] = info

# ---- coverage: each span's PUA codepoints must be in its lang's mapped font ----
fam_codes = {}
for n, d in font_cmaps.items():
    fam_codes.setdefault(d["family"], set()).update(d["codes"])
seen = {}
for ch in report["chapters"].values():
    for sp in ch["tspans"]:
        seen.setdefault(sp["lang"], set()).update(ord(c) for c in pua(sp["text"]))
for lang, codes in seen.items():
    fam = css_map.get(lang)
    if not fam:
        err(f"span lang {lang!r} has no font-family CSS rule")
        continue
    have = fam_codes.get(fam, set())
    missing = sorted(codes - have)
    report["coverage"].append({"lang": lang, "family": fam,
                               "puaCodes": len(codes), "missing": [hex(c) for c in missing]})
    if missing:
        err(f"font {fam!r} does not cover {len(missing)} PUA codepoints used by lang {lang}")

print(json.dumps(report, ensure_ascii=False))
