#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Build Search Index from SVG BOM tables (Composer-style)
------------------------------------------------------

- Scans assets/svgs/*.svg
- Extracts BOM rows using SAME logic as app.js parseBOMTokens()
  (supports multiple BOM tables / repeated headers)
- Generates assets/search-index.json

No external dependencies (stdlib only).
"""

import os
import re
import json
import sys
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SVGS_DIR = os.path.join(ROOT_DIR, "assets", "svgs")
OUT_FILE = os.path.join(ROOT_DIR, "assets", "search-index.json")

SCHEMA_VERSION = 1


# ----------------------------
# Normalization helpers
# ----------------------------

def normalize_partno(s: str) -> str:
    if not s:
        return ""
    return re.sub(r"[\s\-_]", "", s).upper()

def normalize_desc(s: str) -> str:
    if not s:
        return ""
    s = s.lower()
    s = re.sub(r"\s+", " ", s)
    return s.strip()


# ----------------------------
# SVG text extraction (tokens)
# ----------------------------

def extract_svg_text_nodes(svg_path: str):
    """
    Extract textContent from all <text> elements in document order.
    Mimics:
        Array.from(doc.querySelectorAll('text'))
        .map(t => t.textContent.replace(/\\s+/g,' ').trim())
        .filter(Boolean)
    """
    try:
        tree = ET.parse(svg_path)
    except ET.ParseError:
        return []

    root = tree.getroot()

    nodes = []
    # ElementTree keeps document order when iterating
    for el in root.iter():
        tag = el.tag.split("}")[-1].lower()
        if tag != "text":
            continue

        # Collect all text inside this <text> (including nested tspans)
        # Equivalent to DOM textContent.
        txt = "".join(el.itertext())
        txt = re.sub(r"\s+", " ", (txt or "")).strip()
        if txt:
            nodes.append(txt)

    return nodes


# ----------------------------
# BOM parsing (ported from app.js parseBOMTokens)
# ----------------------------

def parse_bom_tokens(nodes):
    """
    Port of app.js parseBOMTokens(doc):
    - Find all header occurrences (supports "Part No" or "Part"+"No")
    - For each header, parse rows as <pos:int> <partNo:any> <qty:int> <desc:any>
    - Merge rows across multiple tables by pos (keep first occurrence per pos)
    """
    headers = []

    def low(x): return (x or "").lower()

    def is_pos(x):
        lx = low(x)
        return x == "Pos." or lx == "pos." or lx == "pos"

    def is_qty(x):
        lx = low(x)
        return x == "Qty." or lx == "qty." or lx == "qty"

    def is_desc(x):
        return low(x) == "description"

    def is_partno(x):
        return low(x) == "part no"

    def is_part(x):
        return low(x) == "part"

    def is_no(x):
        return low(x) == "no"

    for i in range(len(nodes)):
        a = nodes[i]
        b = nodes[i + 1] if i + 1 < len(nodes) else None
        c = nodes[i + 2] if i + 2 < len(nodes) else None
        d = nodes[i + 3] if i + 3 < len(nodes) else None
        e = nodes[i + 4] if i + 4 < len(nodes) else None

        if is_pos(a) and is_partno(b) and is_qty(c) and is_desc(d):
            headers.append({"idx": i, "headerLen": 4})
            continue

        if is_pos(a) and is_part(b) and is_no(c) and is_qty(d) and is_desc(e):
            headers.append({"idx": i, "headerLen": 5})
            continue

    if not headers:
        return []

    rows_by_pos = {}  # pos -> row

    for h in headers:
        tail = nodes[h["idx"] + h["headerLen"] :]

        # Find first plausible row
        start = -1
        for i in range(0, len(tail) - 3):
            pos = tail[i]
            part_no = tail[i + 1]
            qty = tail[i + 2]
            desc = tail[i + 3]

            if re.fullmatch(r"\d+", pos or "") and re.fullmatch(r"\d+", qty or "") and part_no and desc:
                start = i
                break

            # stop if we hit another header (pos) after already scanning some content
            if i > 0 and is_pos(pos):
                break

        if start < 0:
            continue

        i = start
        while i < len(tail) - 3:
            pos = tail[i]
            part_raw = tail[i + 1]
            qty = tail[i + 2]
            desc = tail[i + 3]

            if not re.fullmatch(r"\d+", pos or ""):
                break
            if not re.fullmatch(r"\d+", qty or ""):
                break
            if not part_raw or not desc:
                break

            part_no = re.sub(r"\s+", "", part_raw)

            # keep first occurrence per pos (tables are split, not duplicated)
            if pos not in rows_by_pos:
                rows_by_pos[pos] = {"pos": pos, "partNo": part_no, "qty": qty, "desc": desc}

            i += 4

            # Stop if we appear to have left the table
            if i < len(tail):
                nxt = tail[i]
                if not re.fullmatch(r"\d+", nxt or ""):
                    break

    # return sorted by pos numeric
    out = list(rows_by_pos.values())
    out.sort(key=lambda r: int(r["pos"]))
    return out


# ----------------------------
# Main
# ----------------------------

def main():
    if not os.path.isdir(SVGS_DIR):
        print(f"[ERROR] SVG directory not found: {SVGS_DIR}")
        sys.exit(1)

    entries = []
    svg_count = 0
    row_count = 0
    svgs_with_bom = 0

    for fname in sorted(os.listdir(SVGS_DIR)):
        if not fname.lower().endswith(".svg"):
            continue

        svg_path = os.path.join(SVGS_DIR, fname)
        svg_base = os.path.splitext(fname)[0]
        svg_count += 1

        code = svg_base[4:] if svg_base.startswith("pai_") else svg_base

        nodes = extract_svg_text_nodes(svg_path)
        bom_rows = parse_bom_tokens(nodes)

        if bom_rows:
            svgs_with_bom += 1

        for r in bom_rows:
            entries.append({
                "svgBase": svg_base,
                "code": code,
                "pos": r.get("pos"),
                "partNo": r.get("partNo"),
                "desc": r.get("desc"),
                "qty": r.get("qty"),
                "partNoN": normalize_partno(r.get("partNo") or ""),
                "descN": normalize_desc(r.get("desc") or ""),
            })
            row_count += 1

    index = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "svgsIndexed": svg_count,
        "svgsWithBom": svgs_with_bom,
        "rowsIndexed": row_count,
        "entries": entries,
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print("=== Search Index Built ===")
    print(f"SVGs indexed   : {svg_count}")
    print(f"SVGs with BOM  : {svgs_with_bom}")
    print(f"BOM rows       : {row_count}")
    print(f"Output         : {OUT_FILE}")


if __name__ == "__main__":
    main()
