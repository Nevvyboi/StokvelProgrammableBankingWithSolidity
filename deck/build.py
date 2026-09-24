#!/usr/bin/env python3
"""
Builds deck/index.html: the same 18 slides (plus two appendix slides) as a single self-contained
HTML file. Fonts are inlined as base64 woff2, diagrams are inlined as SVG, screenshots as JPEG.
No CDN, no network. Open it in any browser.

  python3 build.py

Keys: arrows, space, PageUp/Down, Home/End · N notes · F fullscreen · L light theme · G go to
"""
from __future__ import annotations

import base64
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ASSETS = ROOT / "assets"
sys.path.insert(0, str(ROOT / "cards"))
from generate import hash_seed, patch_cells, patch_colours  # noqa: E402

REPO_URL = "https://github.com/Nevvyboi/StokvelProgrammableBankingWithSolidity"
MEMBERS = [("01", "Lerato", "#F4A261"), ("02", "Thabo", "#2A9D8F"), ("03", "Aisha", "#E76F51"), ("04", "Johan", "#8AB17D"), ("05", "Priya", "#B388EB"), ("06", "Sipho", "#E9C46A")]


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def jpeg(path: Path, width: int = 1400, quality: int = 78) -> str:
    im = Image.open(path).convert("RGB")
    if im.width > width:
        im = im.resize((width, int(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def svg_inline(name: str) -> str:
    """The diagram SVG, minus its own background and xml wrapper, so the page theme applies."""
    s = (ASSETS / "diagrams" / f"{name}.svg").read_text()
    s = re.sub(r'<rect class="bg"[^>]*/>', "", s, count=1)
    s = s.replace('data-theme="dark"', 'class="diagram"')
    s = re.sub(r"<style>.*?</style>", "", s, count=1, flags=re.S)
    # scope the diagram's class names so they can't collide with the page's
    s = re.sub(r'class="([^"]+)"', lambda m: 'class="' + " ".join("d-" + c for c in m.group(1).split()) + '"', s)
    s = s.replace('class="d-diagram"', 'class="diagram"')
    return s


def patch_svg(colour: str, seed: str, size: int = 48, cls: str = "") -> str:
    cells = patch_cells(hash_seed(seed), 4)
    tones = patch_colours(colour)
    c = 25
    out = [f'<svg class="patch {cls}" viewBox="0 0 100 100" width="{size}" height="{size}" shape-rendering="crispEdges"><rect width="100" height="100" fill="var(--surface)"/>']
    for (cx, cy, kind, rot, tone) in cells:
        if kind == "empty":
            continue
        px, py = cx * c, cy * c
        fill = tones[tone]
        t = f'transform="rotate({rot * 90} {px + c / 2} {py + c / 2})"'
        if kind == "square":
            out.append(f'<rect x="{px}" y="{py}" width="{c}" height="{c}" fill="{fill}"/>')
        elif kind == "tri":
            out.append(f'<polygon points="{px},{py} {px + c},{py} {px},{py + c}" fill="{fill}" {t}/>')
        elif kind == "half":
            out.append(f'<rect x="{px}" y="{py}" width="{c}" height="{c / 2}" fill="{fill}" {t}/>')
        else:
            out.append(f'<circle cx="{px + c / 2}" cy="{py + c / 2}" r="{c / 3}" fill="{fill}"/>')
    out.append("</svg>")
    return "".join(out)


def notes() -> dict[int, str]:
    text = (ROOT / "talk" / "SPEECH.md").read_text(encoding="utf-8")
    parts = re.split(r"\n## (\d+) · ", text)
    out = {}
    for i in range(1, len(parts), 2):
        body = parts[i + 1].split("\n---")[0]
        body = "\n".join(body.split("\n")[1:]).strip()
        body = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", body)
        body = re.sub(r"`([^`]+)`", r"<code>\1</code>", body)
        body = body.replace("★ ", "")
        out[int(parts[i])] = "".join(f"<p>{p.strip()}</p>" for p in body.split("\n\n") if p.strip())
    return out


def code_html(src: str, highlight: set[int]) -> str:
    kw = {"function", "if", "revert", "external", "view", "returns", "emit", "memory", "storage", "internal", "public", "pure", "mapping", "struct", "contract", "is", "override", "return", "uint256", "uint8", "uint128", "uint64", "bytes32", "bool", "address", "bytes", "calldata", "onlyRelayer"}
    lines = []
    for i, line in enumerate(src.split("\n")):
        toks = []
        for tok in re.findall(r"//.*$|\"[^\"]*\"|[A-Za-z_][A-Za-z0-9_]*|\d+(?:_\d+)*|\s+|[^\sA-Za-z0-9_]+", line):
            esc = tok.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            if tok in kw:
                toks.append(f'<span class="k">{esc}</span>')
            elif tok[:1].isupper() and len(tok) > 1 and not tok.isupper():
                toks.append(f'<span class="ty">{esc}</span>')
            elif re.match(r"^\d", tok):
                toks.append(f'<span class="n">{esc}</span>')
            else:
                toks.append(esc)
        cls = "hl" if i in highlight else "dim"
        lines.append(f'<div class="ln {cls}">{"".join(toks) or "&nbsp;"}</div>')
    return f'<pre class="code">{"".join(lines)}</pre>'


CLOSE_ROUND = """function closeRound() external {
    uint256 owed = pot + unsettled;
    if (reservesAt == 0 || reservesAt + RESERVES_MAX_AGE < block.timestamp) {
        revert ReservesStale(reservesAt, notBefore);
    }
    if (reservesCents < owed) revert ReservesShort(reservesCents, owed);
    if (block.timestamp < roundEndsAt) revert RoundStillOpen(roundEndsAt);

    uint8 recipient = uint8(round % members.length);
    uint256 cents = pot;
    payouts[round] = Payout(recipient, cents == 0, cents, members[recipient].beneficiaryHash);
    pot = 0;
    unsettled += cents;
    emit PayoutDue(round, recipient, cents, members[recipient].beneficiaryHash);

    round += 1;
    roundEndsAt = uint64(block.timestamp) + roundLength;
}"""

RECORD_V2 = """function recordContribution(uint8 memberId, uint128 cents, bytes32 investecRef)
    external onlyRelayer
{
    if (seen[investecRef]) revert AlreadyRecorded(investecRef);
    if (memberId >= members.length) revert UnknownMember(memberId);
    if (cents > MAX_CONTRIBUTION_CENTS) revert AmountTooLarge(cents, MAX_CONTRIBUTION_CENTS);

    seen[investecRef] = true;
    members[memberId].paidCents += cents;
    pot += cents;
    totalIn += cents;
    emit ContributionRecorded(round, memberId, cents, investecRef);
}"""


def head(left: str, right: str = "") -> str:
    return f'<div class="head"><span>{left}</span><span class="mono">{right}</span></div>'


def divider(n: int, title: str, promise: str, cut: bool = False) -> str:
    strip = "".join(patch_svg(c, f"member:{num}", 46, "quilt-in") for num, _, c in MEMBERS)
    return (head(f"Demo {n}", "live · sandbox and testnet only" + (" · ✂ can be cut" if cut else ""))
            + f'<div class="demo-no">DEMO {n}</div><h2 class="demo-title">{title}</h2><p class="promise">{promise}</p><div class="strip">{strip}</div>')


def build() -> str:
    N = notes()
    fonts = {
        "Space Grotesk": ASSETS / "fonts" / "space-grotesk" / "space-grotesk-latin-wght-normal.woff2",
        "Inter": ASSETS / "fonts" / "inter" / "inter-latin-wght-normal.woff2",
        "JetBrains Mono": ASSETS / "fonts" / "jetbrains-mono" / "jetbrains-mono-latin-wght-normal.woff2",
    }
    font_css = "".join(f'@font-face{{font-family:"{k}";src:url(data:font/woff2;base64,{b64(v)}) format("woff2");font-weight:100 900;font-display:block}}' for k, v in fonts.items())
    shots = {k: jpeg(ASSETS / "screenshots" / f"{k}.png") for k in ["dashboard", "dashboard-frozen", "dashboard-refused", "signing-station"]}
    phone = jpeg(ASSETS / "screenshots" / "audience-phone.png", 500)
    cards = jpeg(ASSETS / "cards" / "sheet-mockup.png", 1000)
    import qrcode
    import qrcode.image.svg
    qr = qrcode.make(REPO_URL, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=1).to_string().decode()
    qr = re.sub(r'<\?xml[^>]*\?>', "", qr).replace("<svg", '<svg class="qr"', 1)

    hero_col = "".join(patch_svg(c, f"member:{num}:hero", 88, "quilt-in") for num, _, c in MEMBERS)
    slides = []

    slides.append(f'''
      <div class="eyebrow mono">Investec developer community · Q4 2026</div>
      <h1 class="title">The Treasurer<br>Is a Smart Contract</h1>
      <p class="sub">Rebuilding the stokvel with Solidity and Investec Programmable Banking</p>
      <p class="tag">Investec holds the rand. The chain holds the rulebook. The relayer carries messages and can't decide.</p>
      <p class="mono who"><b>Nevin Tom</b> &nbsp; data engineer · MSc student · builds on Programmable Banking</p>
      <div class="hero-col">{hero_col}</div>''')

    slides.append(head("A group chat, December", "fictional · every name in this talk is made up") + '''
      <div class="chat">
        <div class="bubble">Guys, where's December's money? <span class="face"><i></i><i></i><b></b></span></div><div class="stamp-time mono">Priya · 09:41</div>
        <div class="bubble short">Guys?</div><div class="stamp-time mono">Priya · 09:58</div>
        <div class="bubble short dots">…</div><div class="stamp-time mono">Thabo is typing</div>
      </div>
      <div class="aside"><h2>Every stokvel has this thread.</h2><p>One spreadsheet, one banking app, one person.</p></div>''')

    slides.append(head("Scale", "NASASA, August 2025") + '''
      <div class="stats"><div><b>11 million</b><span>members</span></div><div><b>810,000</b><span>stokvels</span></div><div><b>R50bn</b><span>saved a year</span></div></div>
      <p class="line">Fifty billion rand a year, moving on trust.</p>
      <div class="foot mono">Source: NASASA via EWN, 14 Aug 2025 · ewn.co.za/2025/08/14/more-than-11-million-south-africans-are-members-of-stokvels-nasasa</div>''')

    slides.append(head("Single point of trust", "how it works today") + '''
      <div class="spot">
        <div class="boxes">
          <div class="box"><b>The ledger</b><span class="mono">a notebook, a spreadsheet</span></div>
          <div class="box"><b>The money</b><span class="mono">the treasurer's own account</span></div>
          <div class="box"><b>The rules</b><span class="mono">the WhatsApp group</span></div>
        </div>
        <svg class="lines" viewBox="0 0 300 400" preserveAspectRatio="none"><path d="M0 60 L300 200 M0 200 L300 200 M0 340 L300 200" stroke="var(--muted)" stroke-width="1.5" fill="none"/></svg>
        <div class="circle"><span>the</span><b>treasurer</b></div>
        <div class="verdict"><div>One person.</div><div>Three jobs.</div><div class="danger">No audit trail.</div></div>
      </div>
      <div class="foot mono">Investec doesn't sell a stokvel account. With Programmable Banking, it doesn't need to.</div>''')

    slides.append(f'<div class="diagram-wrap">{svg_inline("pattern")}</div>')
    slides.append(f'<div class="diagram-wrap hash">{svg_inline("hash-chain")}</div>')

    slides.append(divider(1, "The committee", "Six volunteers, six cards, one constitution. Nobody types a name in: the chain knows each member from a signature."))
    slides.append(divider(2, "Swipe and round-up", "Aisha buys R87 of bread. The card rounds up to R90 and R3 lands on chain with her number on it."))
    slides.append(head("The whole payout rule", "contracts/src/Stokvel.sol") + code_html(CLOSE_ROUND, {2, 3, 4, 5, 6, 8}) + '<p class="caption">No function takes a recipient. <code>round % 6</code>, always.</p>')
    slides.append(divider(3, "Month end", "The contract says who. Investec pays through the API. The chain records the bank's own payment reference."))
    slides.append(divider(4, "The treasurer steals", "R1,000 leaves the account with the label “Admin fees”. Watch the payout freeze."))
    slides.append(head("Demo 5 · Double webhook", "the one line between V1 and V2") + code_html(RECORD_V2, {3}) + '<p class="caption">V1 is this function without line 4. Same bank transaction, sent twice: V1 counts it twice, V2 says no.</p><div class="stamp danger big" style="right:8vw;bottom:9vh">refused</div>')
    slides.append(head("Demo 6 · The fuzzer", "✂ can be cut for a 20 minute slot") + '''
      <div class="two">
        <div>
          <h2 class="h">Four invariants, always</h2>
          <ol class="inv mono"><li>sum(paidCents) == totalIn</li><li>totalIn - settledOut == pot + unsettled</li><li>no Investec ref is ever used twice</li><li>no close while reserves &lt; owed</li></ol>
          <p class="muted">10,000 random months: contributions, duplicate webhooks, theft, refunds, time travel, closes, payouts.</p>
        </div>
        <pre class="term mono">$ ./scripts/fuzz.sh

<span class="danger">[FAIL: an Investec ref was recorded twice: 2 != 1]</span>
  contribute(uint8,uint128) args=[156, 2592000]
  duplicateWebhook(uint256) args=[3]
<span class="danger">[FAIL: totalIn != what the bank received: 1184000 != 592000]</span>

<span class="danger">Suite result: FAILED. 3 passed; 2 failed  (V1)</span>
<span class="success">Suite result: ok.     5 passed; 0 failed  (V2)</span></pre>
      </div>
      <p class="caption">Write down what must always be true. Let a machine try to make it false.</p>''')
    slides.append(divider(7, "Vote", "Four cards sign one English sentence: “raise the contribution from R5,000 to R6,000”. Then a timelock. Then it's the rule."))
    slides.append(divider(8, "Stolen card", "The thief holds Sipho's key. The committee moves Sipho to a spare card, and the stolen one stops being anyone."))
    slides.append(divider(9, "Kill the server", "The relayer dies on stage. The book is still on the shelf: every screen rebuilds from chain events, and nothing is sent twice.", True))
    slides.append(head("Honest limits, and what's next", "said out loud") + '''
      <div class="two limits">
        <div><h2 class="danger">What this doesn't do</h2>
          <div class="row"><b>Trusted relayer</b><span>it reports what the bank did</span></div>
          <div class="row"><b>Group account KYC</b><span>six people on one key is a demo</span></div>
          <div class="row"><b>No tokenised rand</b><span>yet, on purpose</span></div>
          <div class="row"><b>QR cards</b><span>should be passkeys</span></div></div>
        <div><h2 class="primary">Next</h2>
          <div class="row"><b>Passkeys</b><span>a phone that signs</span></div>
          <div class="row"><b>A real club account</b><span>with the bank's own controls</span></div>
          <div class="row"><b>Rage-quit and late fees</b><span>the rules a real stokvel has</span></div>
          <div class="row"><b>Tokenised rand</b><span>when a bank stands behind one</span></div></div>
      </div>
      <div class="foot mono">With thanks to Peter Smythe · github.com/petersmythe/invapi-dual-auth · github.com/petersmythe/investec-swipe-n-save</div>''')
    committee = "".join(f'<div>{patch_svg(c, f"member:{num}", 52, "quilt-in")}<span class="mono">{name}</span></div>' for num, name, c in MEMBERS)
    slides.append(f'''
      <div class="close">
        <h1>We didn't replace the trust.<br><span class="primary">We wrote it down where nobody can erase it.</span></h1>
        <p class="muted">Thank you, committee.</p>
        <div class="committee">{committee}</div>
        <div class="qr-wrap">{qr}<div class="mono small">github.com/Nevvyboi/<br>StokvelProgrammableBankingWithSolidity</div></div>
      </div>
      <div class="foot mono">one command runs the whole demo: ./scripts/demo.sh --mock</div>''')
    # appendix
    slides.append(f'<div class="diagram-wrap">{svg_inline("threat-model")}</div>')
    slides.append(f'<div class="diagram-wrap">{svg_inline("architecture")}</div>')
    slides.append(head("Appendix · The screens", "stage/") + f'''
      <div class="shots"><img src="{shots["dashboard"]}" alt="The projector dashboard"><img src="{shots["dashboard-frozen"]}" alt="Frozen"><img src="{shots["signing-station"]}" alt="Signing station"><img src="{cards}" alt="The printed cards"></div>''')

    notes_json = json.dumps({str(k): v for k, v in N.items()})
    sections = "".join(f'<section class="slide" data-n="{i + 1}">{body}</section>' for i, body in enumerate(slides))
    style = (HERE / "style.css").read_text()
    script = (HERE / "deck.js").read_text()
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Treasurer Is a Smart Contract</title>
<style>{font_css}{style}</style></head>
<body data-theme="dark">
<div class="deck">{sections}</div>
<aside class="notes" hidden><div class="notes-head mono"><span id="notes-n"></span><span>N to hide</span></div><div id="notes-body"></div></aside>
<div class="hud mono"><span id="hud-n"></span> · ← → · N notes · F fullscreen · L light</div>
<script>window.NOTES = {notes_json};</script>
<script>{script}</script>
<img hidden alt="" src="{phone}">
</body></html>'''


if __name__ == "__main__":
    out = HERE / "index.html"
    out.write_text(build())
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
