#!/usr/bin/env python3
"""
Member cards for The Q4 Stokvel.

Makes nine throwaway testnet keys (six members, two spares, one treasurer) and lays them out as
print-ready credit-card sized cards: 85.6 x 54 mm, 3 mm bleed, crop marks, eight to an A4 sheet,
fronts on one sheet and backs on the next so a print shop can duplex them.

  python3 generate.py                 real keys -> out/ (gitignored)
  python3 generate.py --preview       fake, visibly invalid keys -> ../assets/cards/ previews

Front: club name, member number, persona name, the member's quilt patch, turn in rotation.
Back:  the signing QR (stokvel:v1:<key>), and two warnings that mean it.

The quilt patch is the same algorithm as stage/lib/quilt.tsx, ported bit for bit, so a card and
the dashboard draw the same patch for the same member.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import secrets
import sys
from pathlib import Path

import qrcode
from qrcode.image.pil import PilImage
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FONTS = ROOT / "assets" / "fonts"

# ------------------------------------------------------------------ identity
BG = "#0B1426"
PAPER = "#F4F1EA"
MUTED = "#8A96AD"
PRIMARY = "#2EC4B6"
DANGER = "#FF5A5F"

MEMBERS = [
    ("01", "Lerato", "#F4A261", 1),
    ("02", "Thabo", "#2A9D8F", 2),
    ("03", "Aisha", "#E76F51", 3),
    ("04", "Johan", "#8AB17D", 4),
    ("05", "Priya", "#B388EB", 5),
    ("06", "Sipho", "#E9C46A", 6),
]
SPARES = [
    ("04b", "Spare card", "#8AB17D", "Replaces card 04 after a RotateKey vote"),
    ("07", "Spare card", "#8A96AD", "Unassigned. Voted in when a member needs it"),
]
TREASURER = ("T", "Treasurer", PRIMARY, "Holds the hat. Never holds the money.")

CARD_W, CARD_H = 85.6 * mm, 54 * mm
BLEED = 3 * mm
COLS, ROWS = 2, 4

# ------------------------------------------------------------------ quilt, ported from stage/lib/quilt.tsx
M32 = 0xFFFFFFFF


def hash_seed(text: str) -> int:
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & M32
    return h


def rng(seed: int):
    s = (seed & M32) or 1

    def nxt() -> float:
        nonlocal s
        s = (s ^ ((s << 13) & M32)) & M32
        s = (s ^ (s >> 17)) & M32
        s = (s ^ ((s << 5) & M32)) & M32
        return (s % 10_000) / 10_000

    return nxt


def patch_cells(seed: int, n: int = 4):
    r = rng(seed)
    cells = []
    symmetric = r() > 0.3
    for y in range(n):
        for x in range(n):
            sx = n - 1 - x if symmetric and x >= n / 2 else x
            cell_seed = hash_seed(f"{seed}:{sx}:{y}") if symmetric else hash_seed(f"{seed}:{x}:{y}")
            rr = rng(cell_seed)
            k = rr()
            kind = "tri" if k < 0.42 else "square" if k < 0.64 else "half" if k < 0.82 else "dot" if k < 0.9 else "empty"
            rot = math.floor(rr() * 4)
            if symmetric and x >= n / 2 and kind in ("tri", "half"):
                rot = (5 - rot) % 4
            tone = math.floor(rr() * 3)
            cells.append((x, y, kind, rot, tone))
    return cells


def shade(hex_colour: str, amount: float) -> str:
    n = int(hex_colour[1:], 16)
    r, g, b = (n >> 16) & 255, (n >> 8) & 255, n & 255

    def f(c: int) -> int:
        v = c + ((255 - c) * amount if amount > 0 else c * amount)
        return max(0, min(255, math.floor(v + 0.5)))

    return "#%02x%02x%02x" % (f(r), f(g), f(b))


def patch_colours(colour: str):
    return [colour, shade(colour, -0.4), shade(colour, 0.3)]


def draw_patch(c: canvas.Canvas, x: float, y: float, size: float, colour: str, seed: str, base: str = "#13203A", n: int = 4):
    """Draw one quilt block with its bottom-left corner at (x, y)."""
    cells = patch_cells(hash_seed(seed), n)
    tones = patch_colours(colour)
    cell = size / n
    c.setFillColor(base)
    c.rect(x, y, size, size, stroke=0, fill=1)
    for (cx, cy, kind, rot, tone) in cells:
        if kind == "empty":
            continue
        # SVG y runs down, PDF y runs up: flip the row
        px, py = x + cx * cell, y + (n - 1 - cy) * cell
        c.setFillColor(tones[tone])
        c.saveState()
        c.translate(px + cell / 2, py + cell / 2)
        c.rotate(-rot * 90)  # SVG rotates clockwise, PDF anticlockwise
        h = cell / 2
        if kind == "square":
            c.rect(-h, -h, cell, cell, stroke=0, fill=1)
        elif kind == "tri":
            p = c.beginPath()
            p.moveTo(-h, h)
            p.lineTo(h, h)
            p.lineTo(-h, -h)
            p.close()
            c.drawPath(p, stroke=0, fill=1)
        elif kind == "half":
            c.rect(-h, 0, cell, h, stroke=0, fill=1)
        else:
            c.circle(0, 0, cell / 3, stroke=0, fill=1)
        c.restoreState()


# ------------------------------------------------------------------ keys
def new_key() -> str:
    return "0x" + secrets.token_hex(32)


def address_of(private_key_hex: str) -> str:
    from eth_keys import keys

    return keys.PrivateKey(bytes.fromhex(private_key_hex[2:])).public_key.to_checksum_address()


def fake_key(label: str) -> str:
    # visibly not a key: wrong length, letters outside hex, says so
    return f"0xPREVIEW-NOT-A-REAL-KEY-{label}-DO-NOT-PRINT-THIS-ONE"


# ------------------------------------------------------------------ drawing
def fonts():
    pdfmetrics.registerFont(TTFont("Grotesk", str(FONTS / "space-grotesk" / "SpaceGrotesk-Medium.ttf")))
    pdfmetrics.registerFont(TTFont("GroteskBold", str(FONTS / "space-grotesk" / "SpaceGrotesk-Bold.ttf")))
    pdfmetrics.registerFont(TTFont("Inter", str(FONTS / "inter" / "Inter-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("InterMedium", str(FONTS / "inter" / "Inter-Medium.ttf")))
    pdfmetrics.registerFont(TTFont("Mono", str(FONTS / "jetbrains-mono" / "JetBrainsMono-Regular.ttf")))


def crop_marks(c: canvas.Canvas, x: float, y: float, w: float, h: float, length: float = 3 * mm, gap: float = BLEED):
    c.setStrokeColor("#000000")
    c.setLineWidth(0.25)
    for (px, py, dx, dy) in [(x, y, -1, -1), (x + w, y, 1, -1), (x, y + h, -1, 1), (x + w, y + h, 1, 1)]:
        c.line(px + dx * gap, py, px + dx * (gap + length), py)
        c.line(px, py + dy * gap, px, py + dy * (gap + length))


def card_front(c: canvas.Canvas, x: float, y: float, number: str, name: str, colour: str, line: str):
    """x, y is the trim box's bottom left. Draws bleed, then the card."""
    c.setFillColor(BG)
    c.rect(x - BLEED, y - BLEED, CARD_W + 2 * BLEED, CARD_H + 2 * BLEED, stroke=0, fill=1)

    # a strip of the member's quilt down the left, three blocks
    strip = 15 * mm
    for i in range(3):
        draw_patch(c, x - BLEED, y - BLEED + i * (CARD_H + 2 * BLEED) / 3, (CARD_H + 2 * BLEED) / 3, colour, f"member:{number}:{i}")
    # the member's own patch, the one the dashboard shows
    draw_patch(c, x + strip + 4 * mm, y + CARD_H - 8 * mm - 14 * mm, 14 * mm, colour, f"member:{number}")

    c.setFillColor(PAPER)
    c.setFont("Grotesk", 6.2)
    c.drawString(x + strip + 21 * mm, y + CARD_H - 9 * mm, "THE Q4 STOKVEL")
    c.setFillColor(MUTED)
    c.setFont("Mono", 6)
    c.drawString(x + strip + 21 * mm, y + CARD_H - 13 * mm, "investec developer community, q4 2026")

    c.setFillColor(PAPER)
    c.setFont("GroteskBold", 20 if len(name) < 8 else 16)
    c.drawString(x + strip + 4 * mm, y + 15 * mm, name)
    c.setFillColor(colour)
    c.setFont("Grotesk", 11)
    c.drawRightString(x + CARD_W - 5 * mm, y + CARD_H - 9.5 * mm, number)

    c.setStrokeColor(MUTED)
    c.setLineWidth(0.3)
    c.line(x + strip + 4 * mm, y + 11.5 * mm, x + CARD_W - 5 * mm, y + 11.5 * mm)
    c.setFillColor(MUTED)
    c.setFont("Inter", 6.5)
    c.drawString(x + strip + 4 * mm, y + 7 * mm, line)


def card_back(c: canvas.Canvas, x: float, y: float, number: str, name: str, colour: str, qr_text: str, preview: bool):
    c.setFillColor(PAPER)
    c.rect(x - BLEED, y - BLEED, CARD_W + 2 * BLEED, CARD_H + 2 * BLEED, stroke=0, fill=1)

    # QR on the left, dark on paper, quiet zone kept clear
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=0)
    qr.add_data(qr_text)
    qr.make(fit=True)
    img: PilImage = qr.make_image(fill_color=BG, back_color=PAPER)
    size = 38 * mm
    tmp = HERE / "out" / f".qr-{number}.png"
    tmp.parent.mkdir(exist_ok=True)
    img.get_image().save(tmp)
    c.drawImage(str(tmp), x + 6 * mm, y + (CARD_H - size) / 2, size, size)
    tmp.unlink(missing_ok=True)

    tx = x + 6 * mm + size + 5 * mm
    c.setFillColor(BG)
    c.setFont("GroteskBold", 10)
    c.drawString(tx, y + CARD_H - 10 * mm, f"{number}  {name}")
    c.setFont("Grotesk", 7)
    c.drawString(tx, y + CARD_H - 14.5 * mm, "Scan at the signing station")

    c.setFillColor(DANGER)
    c.setFont("InterMedium", 7.2)
    c.drawString(tx, y + 20 * mm, "Keys are cash.")
    c.drawString(tx, y + 16.5 * mm, "Don't let anyone")
    c.drawString(tx, y + 13 * mm, "photograph this.")
    c.setFillColor(MUTED)
    c.setFont("Inter", 5.8)
    c.drawString(tx, y + 7.5 * mm, "Testnet only, no real value.")
    if preview:
        c.setFillColor(DANGER)
        c.setFont("Mono", 5)
        c.drawString(x + 6 * mm, y + 4 * mm, "PREVIEW: fake key, do not print")

    # a thin strip of the member's colour on the far edge, so backs are sortable
    c.setFillColor(colour)
    c.rect(x + CARD_W - 3 * mm + BLEED, y - BLEED, 3 * mm, CARD_H + 2 * BLEED, stroke=0, fill=1)


def sheet_positions(mirror: bool = False):
    """Eight trim boxes on A4, centred, with room for bleed and marks. Mirrored for the back sheet."""
    page_w, page_h = A4
    cell_w, cell_h = CARD_W + 2 * BLEED + 4 * mm, CARD_H + 2 * BLEED + 4 * mm
    total_w, total_h = COLS * cell_w, ROWS * cell_h
    ox, oy = (page_w - total_w) / 2, (page_h - total_h) / 2
    out = []
    for r in range(ROWS):
        for col in range(COLS):
            cc = COLS - 1 - col if mirror else col
            out.append((ox + cc * cell_w + BLEED + 2 * mm, oy + (ROWS - 1 - r) * cell_h + BLEED + 2 * mm))
    return out


def build(cards: list[dict], pdf_path: Path, preview: bool):
    fonts()
    c = canvas.Canvas(str(pdf_path), pagesize=A4)
    c.setTitle("The Q4 Stokvel member cards")
    per_sheet = COLS * ROWS
    for start in range(0, len(cards), per_sheet):
        batch = cards[start : start + per_sheet]
        # fronts
        for card, (x, y) in zip(batch, sheet_positions()):
            card_front(c, x, y, card["label"], card["name"], card["colour"], card["line"])
            crop_marks(c, x, y, CARD_W, CARD_H)
        c.setFillColor(MUTED)
        c.setFont("Mono", 7)
        c.drawString(12 * mm, 8 * mm, f"The Q4 Stokvel · fronts · sheet {start // per_sheet + 1} · 85.6 x 54 mm, 3 mm bleed")
        c.showPage()
        # backs, mirrored for duplex
        for card, (x, y) in zip(batch, sheet_positions(mirror=True)):
            card_back(c, x, y, card["label"], card["name"], card["colour"], card["qr"], preview)
            crop_marks(c, x, y, CARD_W, CARD_H)
        c.setFillColor(MUTED)
        c.setFont("Mono", 7)
        c.drawString(12 * mm, 8 * mm, f"The Q4 Stokvel · backs · sheet {start // per_sheet + 1} · flip on the long edge")
        c.showPage()
    c.save()


def make_cards(preview: bool) -> list[dict]:
    cards = []
    for number, name, colour, turn in MEMBERS:
        key = fake_key(number) if preview else new_key()
        cards.append({"label": number, "name": name, "colour": colour, "line": f"Turn in rotation: {turn} of 6", "privateKey": key, "memberId": turn - 1})
    for number, name, colour, line in SPARES:
        key = fake_key(number) if preview else new_key()
        cards.append({"label": number, "name": name, "colour": colour, "line": line, "privateKey": key})
    number, name, colour, line = TREASURER
    cards.append({"label": number, "name": name, "colour": colour, "line": line, "privateKey": fake_key(number) if preview else new_key()})
    for card in cards:
        card["qr"] = f"stokvel:v1:{card['privateKey']}"
        card["address"] = None if preview else address_of(card["privateKey"])
    return cards


def render_previews(pdf_path: Path, out_dir: Path):
    import fitz  # PyMuPDF

    doc = fitz.open(pdf_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    # sheet 1 front and back, at 150 dpi
    for i, name in [(0, "sheet-fronts.png"), (1, "sheet-backs.png")]:
        doc[i].get_pixmap(dpi=150).save(out_dir / name)
    # card 03 front and back, cropped from the sheet at 300 dpi (third card: row 2, column 1)
    pos = sheet_positions()[2]
    posb = sheet_positions(mirror=True)[2]
    page_h = A4[1]
    for page_i, (x, y), name in [(0, pos, "front-03.png"), (1, posb, "back-03.png")]:
        rect = fitz.Rect(x / 72 * 72, (page_h - y - CARD_H), x + CARD_W, page_h - y)  # PDF points, y flipped
        doc[page_i].get_pixmap(dpi=300, clip=rect).save(out_dir / name)
    doc.close()


def photo_mockup(out_dir: Path):
    """A photo-style mockup: the printed sheet lying on a dark table, slightly turned, with a shadow."""
    from PIL import Image, ImageFilter

    sheet = Image.open(out_dir / "sheet-fronts.png").convert("RGBA")
    scale = 900 / sheet.height
    sheet = sheet.resize((int(sheet.width * scale), 900), Image.LANCZOS)
    rotated = sheet.rotate(-4, expand=True, resample=Image.BICUBIC)
    canvas_img = Image.new("RGBA", (1600, 1100), (11, 20, 38, 255))
    shadow = Image.new("RGBA", rotated.size, (0, 0, 0, 0))
    alpha = rotated.split()[3]
    shadow.paste((0, 0, 0, 160), (0, 0), alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    px, py = (1600 - rotated.width) // 2, (1100 - rotated.height) // 2
    canvas_img.alpha_composite(shadow, (px + 26, py + 34))
    canvas_img.alpha_composite(rotated, (px, py))
    canvas_img.convert("RGB").save(out_dir / "sheet-mockup.png", quality=92)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="fake keys, previews into ../assets/cards")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    preview = args.preview
    out_dir = Path(args.out) if args.out else (ROOT / "assets" / "cards" if preview else HERE / "out")
    out_dir.mkdir(parents=True, exist_ok=True)
    cards = make_cards(preview)
    pdf_path = out_dir / ("preview-cards.pdf" if preview else "cards.pdf")
    build(cards, pdf_path, preview)
    print(f"wrote {pdf_path} ({len(cards)} cards, {math.ceil(len(cards) / (COLS * ROWS)) * 2} pages)")

    if preview:
        render_previews(pdf_path, out_dir)
        photo_mockup(out_dir)
        pdf_path.unlink()  # the previews are the point; the PDF with fake keys would only confuse
        for p in ["front-03.png", "back-03.png", "sheet-fronts.png", "sheet-backs.png", "sheet-mockup.png"]:
            print(f"wrote {out_dir / p}")
        return

    keys = {"cards": [{"label": c["label"], "name": c["name"], "privateKey": c["privateKey"], "address": c["address"], **({"memberId": c["memberId"]} if "memberId" in c else {})} for c in cards]}
    (out_dir / "keys.json").write_text(json.dumps(keys, indent=2))
    members = [c for c in cards if "memberId" in c]
    members_json = {
        "keys": [c["address"] for c in members],
        "privateKeys": [c["privateKey"] for c in members],
        "beneficiaryIds": [keccak_hex(f"beneficiary:{c['name']}") for c in members],
        "spares": {c["label"]: c["address"] for c in cards if "memberId" not in c},
    }
    (out_dir / "members.json").write_text(json.dumps(members_json, indent=2))
    os.chmod(out_dir / "keys.json", 0o600)
    print(f"wrote {out_dir / 'keys.json'} (chmod 600) and {out_dir / 'members.json'}")
    print("Deploy with: MEMBERS_FILE=../cards/out/members.json forge script script/Deploy.s.sol ...")


def keccak_hex(text: str) -> str:
    from eth_utils import keccak

    return "0x" + keccak(text=text).hex()


if __name__ == "__main__":
    sys.exit(main())
