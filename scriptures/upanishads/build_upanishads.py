import zipfile, re, html, json, os

home = os.path.expanduser("~")
search_dirs = [os.getcwd(), os.path.join(home, "Desktop"), os.path.join(home, "Downloads")]

def find_file(name):
    for d in search_dirs:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None

def process_volume(vol_num, epub_filename, out_txt_name, out_toc_name):
    epub_path = find_file(epub_filename)
    if not epub_path:
        print("[-] Could not find " + epub_filename)
        return

    print("[+] Processing Volume " + str(vol_num) + ": " + epub_path)
    z = zipfile.ZipFile(epub_path)

    ncx_targets = {}
    ncx_name = next((n for n in z.namelist() if n.endswith("toc.ncx")), None)
    if ncx_name:
        ncx_raw = z.read(ncx_name).decode("utf-8", errors="ignore")
        points = re.findall(r"(?s)<navPoint[^>]*>.*?<text[^>]*>(.*?)</text>.*?<content[^>]*src=[\"']([^\"']+)[\"']", ncx_raw)
        for t, s in points:
            title_clean = html.unescape(t).strip()
            file_target = os.path.basename(s.split("#")[0].strip())
            if title_clean and file_target and not re.match(r"^(page\s+\d+|[0-9]+)$", title_clean, re.I):
                ncx_targets.setdefault(file_target, []).append(title_clean)

    page_files = [f for f in z.namelist() if re.search(r"page_\d+\.html$", f)]
    page_files.sort(key=lambda x: int(re.search(r"page_(\d+)\.html$", x).group(1)))

    full_lines = []
    toc_entries = []
    current_line = 1

    book_pat = re.compile(r"^((KHANDOGYA|CHANDOGYA|TALAVAKARA|KENA|AITAREYA|KAUSHITAKI|VAJASANEYI|ISA|KATHA|MUNDAKA|TAITTIRIYA|BRIHADARANYAKA|BRIHAD-ARANYAKA|SVETASVATARA|PRASNA|MAITRAYANA|MAITRI)[\s\-]+UPANISHAD.*)", re.I)
    sub_pat = re.compile(r"^((FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)[\s\-]+(PRAPATHAKA|ADHYAYA|VALLI|BRAHMANA|KHANDA|SECTION|PRAKASAKA).*)", re.I)

    for pf in page_files:
        base_f = os.path.basename(pf)

        if base_f in ncx_targets:
            for title in ncx_targets[base_f]:
                toc_entries.append({"title": title, "line": current_line})
                full_lines.append("\n=== " + title + " ===\n\n")
                current_line += 3

        raw = z.read(pf).decode("utf-8", errors="ignore")
        raw = re.sub(r"(?is)<(head|style|script)[^>]*>.*?</\1>", "", raw)
        raw = re.sub(r"(?i)<(p|div|br|hr|h[1-6]|li|blockquote)[^>]*>", "\n", raw)
        raw = re.sub(r"<[^>]+>", " ", raw)
        raw = html.unescape(raw)

        for l in raw.splitlines():
            clean_l = re.sub(r"\s+", " ", l).strip()
            if not clean_l or re.match(r"^(page\s+[0-9]+|[0-9]+)$", clean_l, re.I):
                continue
            if len(clean_l) < 3:
                continue

            m_book = book_pat.match(clean_l)
            m_sub = sub_pat.match(clean_l)

            if m_book and len(clean_l) < 80:
                t_str = m_book.group(1).strip()
                toc_entries.append({"title": t_str, "line": current_line})
                full_lines.append("\n=== " + t_str + " ===\n")
                current_line += 2
            elif m_sub and len(clean_l) < 80:
                t_str = m_sub.group(1).strip()
                toc_entries.append({"title": "  - " + t_str, "line": current_line})
                full_lines.append("\n--- " + t_str + " ---\n")
                current_line += 2
            else:
                full_lines.append(clean_l + "\n")
                current_line += 1

    with open(out_txt_name, "w", encoding="utf-8") as f:
        f.writelines(full_lines)

    with open(out_toc_name, "w", encoding="utf-8") as f:
        json.dump(toc_entries, f, indent=2)

    print("    Done! Generated:")
    print("    - " + out_txt_name + " (" + str(current_line) + " lines)")
    print("    - " + out_toc_name + " (" + str(len(toc_entries)) + " sections indexed)\n")

process_volume(1, "upanishads01ml.epub", "upanishads_vol1.txt", "upanishads_vol1_toc.json")
process_volume(2, "upanishads02ml.epub", "upanishads_vol2.txt", "upanishads_vol2_toc.json")
