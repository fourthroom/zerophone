import zipfile, re, html, json, os

folder = os.path.expanduser("~/Desktop/webrtc-server/scriptures/upanishads")

def extract_epub(epub_filename, out_txt_name, out_toc_name):
    epub_path = os.path.join(folder, epub_filename)
    if not os.path.exists(epub_path):
        epub_path = epub_filename
        if not os.path.exists(epub_path):
            print(f"[-] Could not find {epub_filename}")
            return None, None

    print(f"[+] Re-extracting from clean EPUB: {epub_filename}...")
    z = zipfile.ZipFile(epub_path)

    # 1. Parse TOC from toc.ncx using regex on raw labels & targets
    toc_map = {}
    ncx_name = next((n for n in z.namelist() if n.endswith("toc.ncx")), None)
    if ncx_name:
        ncx_content = z.read(ncx_name).decode("utf-8", errors="ignore")
        # Match <navLabel><text>Title</text></navLabel><content src="page_X.html"
        matches = re.findall(r"<text[^>]*>(.*?)</text>\s*</navLabel>\s*<content[^>]*src=[\"']([^\"'#]+)", ncx_content, re.DOTALL)
        for t, src in matches:
            clean_title = html.unescape(t).strip()
            target_page = os.path.basename(src.strip())
            if clean_title and target_page:
                toc_map.setdefault(target_page, []).append(clean_title)

    # 2. Extract every page file in numerical order
    pages = [f for f in z.namelist() if re.search(r"page_\d+\.html$", f)]
    pages.sort(key=lambda x: int(re.search(r"page_(\d+)\.html$", x).group(1)))

    clean_text = []
    toc = []
    line_no = 1

    for p in pages:
        p_base = os.path.basename(p)

        # Check if toc.ncx marks this page as a chapter start
        if p_base in toc_map:
            for title in toc_map[p_base]:
                toc.append({"title": title, "line": line_no})
                clean_text.append(f"\n\n{'='*15} {title.upper()} {'='*15}\n\n")
                line_no += 4

        raw = z.read(p).decode("utf-8", errors="ignore")
        # Strip header/style/script blocks
        raw = re.sub(r"(?is)<(head|style|script)[^>]*>.*?</\1>", "", raw)
        # Convert any HTML block breaks into standard newlines
        raw = re.sub(r"(?i)<(br|p|div|hr|h[1-6]|li|blockquote)[^>]*>", "\n", raw)
        # Remove remaining tags
        raw = re.sub(r"<[^>]+>", " ", raw)
        raw = html.unescape(raw)

        # Process lines
        for raw_line in raw.split("\n"):
            line = re.sub(r"\s+", " ", raw_line).strip()
            # Omit scanner page headers or blank lines
            if not line or re.match(r"^(page\s+\d+|\d+)$", line, re.IGNORECASE):
                continue
            clean_text.append(line + "\n")
            line_no += 1

    # Write deliverables
    out_txt_path = os.path.join(folder, out_txt_name)
    out_toc_path = os.path.join(folder, out_toc_name)

    with open(out_txt_path, "w", encoding="utf-8") as f:
        f.writelines(clean_text)

    with open(out_toc_path, "w", encoding="utf-8") as f:
        json.dump(toc, f, indent=2)

    print(f"    -> Created {out_txt_name}: {line_no:,} lines")
    print(f"    -> Created {out_toc_name}: {len(toc)} sections indexed\n")
    return clean_text, toc

# Build Vol 1 and Vol 2
lines1, toc1 = extract_epub("upanishads01ml.epub", "upanishads_vol1.txt", "upanishads_vol1_toc.json")
lines2, toc2 = extract_epub("upanishads02ml.epub", "upanishads_vol2.txt", "upanishads_vol2_toc.json")

# Build a Unified Master File for your ZeroPhone App
if lines1 and lines2:
    print("[+] Merging into single master reader file: upanishads_all.txt ...")
    unified_text = lines1 + ["\n\n" + "="*40 + "\n\n"] + lines2
    unified_toc = []
    
    for item in toc1:
        unified_toc.append({"title": f"Vol 1: {item['title']}", "line": item["line"]})
        
    offset = len(lines1) + 2
    for item in toc2:
        unified_toc.append({"title": f"Vol 2: {item['title']}", "line": item["line"] + offset})

    with open(os.path.join(folder, "upanishads_all.txt"), "w", encoding="utf-8") as f:
        f.writelines(unified_text)
    with open(os.path.join(folder, "upanishads_all_toc.json"), "w", encoding="utf-8") as f:
        json.dump(unified_toc, f, indent=2)

    print(f"    -> Created upanishads_all.txt ({len(unified_text):,} lines)")
    print(f"    -> Created upanishads_all_toc.json ({len(unified_toc)} sections indexed)")
