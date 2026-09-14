import os, re, json

home = os.path.expanduser("~")
folder = os.path.join(home, "Desktop", "webrtc-server", "scriptures", "upanishads")

def process_file(source_name, out_txt_name, out_toc_name):
    src_path = os.path.join(folder, source_name)
    if not os.path.exists(src_path):
        # Fallback to local working directory
        src_path = source_name
        if not os.path.exists(src_path):
            print(f"[-] Could not find {source_name}")
            return

    print(f"[+] Processing {source_name}...")
    with open(src_path, "r", encoding="utf-8", errors="ignore") as f:
        raw_lines = f.readlines()

    clean_lines = []
    toc = []
    current_line = 1

    # Clear chapter patterns: matches Upanishads, Prapathakas, Adhyayas, Vallis, and Khandas
    book_pat = re.compile(r"^((KHANDOGYA|CHANDOGYA|TALAVAKARA|KENA|AITAREYA|KAUSHITAKI|VAJASANEYI|ISA|KATHA|MUNDAKA|TAITTIRIYA|BRIHADARANYAKA|BRIHAD-ARANYAKA|SVETASVATARA|PRASNA|MAITRAYANA|MAITRI)[\s\-]+UPANISHAD.*)", re.I)
    chap_pat = re.compile(r"^((FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)[\s\-]+(PRAPATHAKA|ADHYAYA|VALLI|BRAHMANA|KHANDA|SECTION).*)", re.I)

    for line in raw_lines:
        s = line.strip()
        if not s or re.match(r"^(page\s+\d+|\d+)$", s, re.I):
            continue

        m_book = book_pat.match(s)
        m_chap = chap_pat.match(s)

        if m_book and len(s) < 80:
            title = m_book.group(1).strip()
            toc.append({"title": title, "line": current_line})
            clean_lines.append(f"\n\n{'='*12} {title} {'='*12}\n\n")
            current_line += 4
        elif m_chap and len(s) < 80:
            title = m_chap.group(1).strip()
            toc.append({"title": f"  - {title}", "line": current_line})
            clean_lines.append(f"\n--- {title} ---\n\n")
            current_line += 3
        else:
            clean_lines.append(s + "\n")
            current_line += 1

    out_txt_path = os.path.join(folder, out_txt_name)
    out_toc_path = os.path.join(folder, out_toc_name)

    with open(out_txt_path, "w", encoding="utf-8") as f:
        f.writelines(clean_lines)

    with open(out_toc_path, "w", encoding="utf-8") as f:
        json.dump(toc, f, indent=2)

    print(f"    Done! Created:")
    print(f"    1. {out_txt_name} ({current_line:,} lines)")
    print(f"    2. {out_toc_name} ({len(toc)} books/chapters indexed)\n")

# Process Volume 1 from your existing 754 KB text file
process_file("muller_upanishads_vol1.txt", "upanishads_vol1.txt", "upanishads_vol1_toc.json")
# Process Volume 2 if muller_upanishads_vol2.txt is present
process_file("muller_upanishads_vol2.txt", "upanishads_vol2.txt", "upanishads_vol2_toc.json")
