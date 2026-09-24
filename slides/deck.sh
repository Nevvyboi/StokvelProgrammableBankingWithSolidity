#!/usr/bin/env bash
# Build the decks, export the PDF, render every slide to PNG for a look, and make the contact sheet.
#
#   ./deck.sh            everything
#   ./deck.sh --render   skip the build, just re-render
#
# Needs: python3 with python-pptx, qrcode, pymupdf, pillow (pip install -r generator/requirements.txt)
#        LibreOffice (soffice) for the PDF and the renders; the fonts in assets/fonts installed
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
DARK="The-Treasurer-Is-a-Smart-Contract"
LIGHT="The-Treasurer-Is-a-Smart-Contract-Light"

if [[ "${1:-}" != "--render" ]]; then
  python3 generator/build.py
fi

export HOME="${HOME:-/tmp}"
PROFILE="-env:UserInstallation=file://${TMPDIR:-/tmp}/lo-profile-stokvel"
soffice_pdf() { soffice --headless "$PROFILE" --convert-to pdf --outdir "$(dirname "$1")" "$1" >/dev/null 2>&1; }

echo "exporting PDFs"
soffice_pdf "$PWD/$DARK.pptx"
soffice_pdf "$PWD/$LIGHT.pptx"
ls -la "$DARK.pdf" "$LIGHT.pdf"

echo "rendering slides"
python3 - <<'PY'
import fitz, pathlib
from PIL import Image
root = pathlib.Path("..").resolve()
out = root / "assets" / "slides"
for name, sub in [("The-Treasurer-Is-a-Smart-Contract", "dark"), ("The-Treasurer-Is-a-Smart-Contract-Light", "light")]:
    d = fitz.open(f"{name}.pdf")
    folder = out / sub
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.png"):
        old.unlink()
    for i, page in enumerate(d, start=1):
        page.get_pixmap(dpi=110).save(folder / f"{i:02d}.png")
    print(sub, len(d), "slides rendered to", folder)

# contact sheet of the 18 run-sheet slides, dark deck, 6 x 3
thumbs = [Image.open(out / "dark" / f"{i:02d}.png") for i in range(1, 19)]
tw, th = 400, 225
gap = 12
sheet = Image.new("RGB", (6 * tw + 7 * gap, 3 * th + 4 * gap), (11, 20, 38))
for i, im in enumerate(thumbs):
    im = im.resize((tw, th), Image.LANCZOS)
    x = gap + (i % 6) * (tw + gap)
    y = gap + (i // 6) * (th + gap)
    sheet.paste(im, (x, y))
sheet.save(out / "contact-sheet.png", optimize=True)
print("contact sheet", out / "contact-sheet.png")
PY
