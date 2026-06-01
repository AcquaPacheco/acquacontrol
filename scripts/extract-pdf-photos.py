#!/usr/bin/env python3
"""
Extract product images from a supplier PDF catalog.
Uses spatial matching: finds each product code's position in the page and
matches it to the nearest image above/alongside it.

Usage: python extract-pdf-photos.py <pdf_path>
Output: JSON array — one entry per matched (code, image) pair.
"""
import sys, json, base64, re


def extract_from_pdf(pdf_path):
    import pdfplumber
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    results = []

    with pdfplumber.open(pdf_path) as pdf_text:
        for page_num in range(len(reader.pages)):
            page_pdf   = reader.pages[page_num]
            page_plumb = pdf_text.pages[page_num]

            # ── Text layer ────────────────────────────────────────────────
            text = page_plumb.extract_text() or ''

            # Find "Cód NNNNN" patterns
            codes_re = re.findall(r'[Cc][oó]d\.?\s*(\d{3,6})', text)
            # Standalone 5-digit codes
            standalone = re.findall(r'(?<!\d)(\d{5})(?!\d)', text)
            all_codes = list(dict.fromkeys(codes_re + standalone))

            # Find brand-like headers (uppercase words, Institucional catalog)
            brand_candidates = re.findall(r'^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑA-Za-z\s&]{2,28})$', text, re.MULTILINE)
            brands = [b.strip() for b in brand_candidates
                      if len(b.strip()) > 2
                      and not re.search(r'PRECIO|ENTREGA|DISTRIBU|OFICIALE|CUOTAS|IVA|SUJETO', b, re.I)]

            # ── Images from pypdf (raw bytes) ─────────────────────────────
            raw_images = list(page_pdf.images)
            # Filter: product images > 8 KB; logos/icons are tiny
            product_imgs_pypdf = [img for img in raw_images if len(img.data) > 8_000]

            if not product_imgs_pypdf:
                continue

            # ── Images from pdfplumber (position data) ────────────────────
            # Map: clean_name → {x0, y0, x1, y1}  (pdfplumber gives rects)
            plumb_imgs = page_plumb.images  # list of dicts
            # pdfplumber image names come WITHOUT leading slash
            plumb_map: dict = {}
            for pi in plumb_imgs:
                name = str(pi.get('name', '')).lstrip('/')
                if name:
                    plumb_map[name] = pi

            # ── Try spatial matching first ─────────────────────────────────
            # Get word positions to locate product codes
            try:
                words = page_plumb.extract_words() or []
            except Exception:
                words = []

            # For each code in all_codes, find its bounding box
            # Strategy: find words that are pure digits or "Cód NNNNN" adjacent
            code_positions: dict = {}  # code_str → (cx, cy) center point
            for code in all_codes:
                for w in words:
                    if w.get('text', '').strip() == code:
                        cx = (w['x0'] + w['x1']) / 2.0
                        cy = (w['top'] + w['bottom']) / 2.0
                        code_positions[code] = (cx, cy)
                        break

            # Build a list of pypdf images with their positions (if available)
            matched_imgs = []
            for img in product_imgs_pypdf:
                clean_name = img.name.lstrip('/')
                pos = plumb_map.get(clean_name, {})
                matched_imgs.append({
                    'data':   img.data,
                    'name':   img.name,
                    'pos':    pos,   # may be empty dict if not found
                    'x0':     float(pos.get('x0', 0)),
                    'y0':     float(pos.get('top',  pos.get('y0', 0))),
                    'x1':     float(pos.get('x1', 0)),
                    'y1':     float(pos.get('bottom', pos.get('y1', 0))),
                })

            # ── Match: for each code, find the closest image spatially ───
            matched_pairs: list = []  # list of (code, img_dict) — no duplicates
            used_img_indices = set()

            if code_positions and any(m['x1'] > 0 for m in matched_imgs):
                # Spatial matching: each code → nearest image (prefer image ABOVE code)
                for code in all_codes:
                    if code not in code_positions:
                        continue
                    cx, cy = code_positions[code]
                    best_idx, best_score = None, float('inf')
                    for i, m in enumerate(matched_imgs):
                        if i in used_img_indices:
                            continue
                        if m['x1'] == 0 and m['y1'] == 0:
                            continue
                        # Image center
                        mx = (m['x0'] + m['x1']) / 2.0
                        my = (m['y0'] + m['y1']) / 2.0
                        # Horizontal proximity (same column)
                        dx = abs(mx - cx)
                        # Vertical: image should be ABOVE the code (smaller y in PDF = higher)
                        # pdfplumber uses top-down y, so image.y1 < code.cy means image is above
                        dy = cy - my   # positive = image above code
                        # Score: prefer images that are horizontally close and above the code
                        if dx < 150 and dy > -50:   # within ~1.5in horizontal, code below image
                            score = dx + abs(dy) * 0.5
                            if score < best_score:
                                best_score = score
                                best_idx = i
                    if best_idx is not None:
                        matched_pairs.append((code, matched_imgs[best_idx]))
                        used_img_indices.add(best_idx)
            else:
                # Fallback: positional data unavailable → zip by list order
                n = min(len(all_codes), len(matched_imgs))
                for i in range(n):
                    matched_pairs.append((all_codes[i], matched_imgs[i]))

            # ── Build result entries ──────────────────────────────────────
            for pos_idx, (code, m) in enumerate(matched_pairs):
                data = m['data']
                if data[:3] == b'\xff\xd8\xff':
                    ext, mime = 'jpg', 'image/jpeg'
                elif data[:8] == b'\x89PNG\r\n\x1a\n':
                    ext, mime = 'png', 'image/png'
                elif data[:4] == b'\x00\x00\x00\x0c' or b'ftypjp2 ' in data[:32]:
                    ext, mime = 'jp2', 'image/jp2'
                else:
                    ext, mime = 'jpg', 'image/jpeg'

                b64 = base64.b64encode(data).decode('ascii')  # ascii-safe

                results.append({
                    'page':         page_num + 1,
                    'position':     pos_idx,
                    'total_on_page': len(matched_pairs),
                    'code':         code,          # direct code → no more position guessing needed
                    'name':         m['name'],
                    'ext':          ext,
                    'mime':         mime,
                    'size':         len(data),
                    'base64':       b64,
                    'codes_on_page':  all_codes,
                    'brands_on_page': brands[:5],
                    'text_snippet':   text[:300].replace('\n', ' '),
                })

            # ── Also emit unmatched product images (no code found) ────────
            # so the UI can still show them (they can be matched by brand/order)
            unmatched_imgs = [m for i, m in enumerate(matched_imgs) if i not in used_img_indices]
            for pos_idx2, m in enumerate(unmatched_imgs):
                data = m['data']
                if data[:3] == b'\xff\xd8\xff':
                    ext, mime = 'jpg', 'image/jpeg'
                elif data[:8] == b'\x89PNG\r\n\x1a\n':
                    ext, mime = 'png', 'image/png'
                else:
                    ext, mime = 'jpg', 'image/jpeg'
                b64 = base64.b64encode(data).decode('ascii')
                results.append({
                    'page':         page_num + 1,
                    'position':     len(matched_pairs) + pos_idx2,
                    'total_on_page': len(matched_imgs),
                    'code':         None,          # no match found
                    'name':         m['name'],
                    'ext':          ext,
                    'mime':         mime,
                    'size':         len(data),
                    'base64':       b64,
                    'codes_on_page':  all_codes,
                    'brands_on_page': brands[:5],
                    'text_snippet':   text[:300].replace('\n', ' '),
                })

    return results


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: extract-pdf-photos.py <pdf_path>'}))
        sys.exit(1)

    # Force UTF-8 output to avoid Windows cp1252 issues
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    try:
        data = extract_from_pdf(sys.argv[1])
        print(json.dumps(data, ensure_ascii=True))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
