#!/usr/bin/env python3
"""
Hand-built SVG diagrams for the talk, in the house style. One script writes them all, so a colour
or a wording change is one edit. render.mjs turns each one into PNGs at 2x, dark and light.

  python3 build.py            writes *.svg next to this file
  node render.mjs             writes png/<name>.png and png/<name>-light.png
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "cards"))
from generate import hash_seed, patch_cells, patch_colours  # noqa: E402

W, H = 1600, 900

MEMBERS = [("01", "Lerato", "#F4A261"), ("02", "Thabo", "#2A9D8F"), ("03", "Aisha", "#E76F51"), ("04", "Johan", "#8AB17D"), ("05", "Priya", "#B388EB"), ("06", "Sipho", "#E9C46A")]

STYLE = """
<style>
  :root { --bg:#0B1426; --surface:#13203A; --text:#F4F1EA; --muted:#8A96AD; --rule:#2A3B5E; --primary:#2EC4B6; --danger:#FF5A5F; --success:#3DDC97; --paper:#F4F1EA; --ink:#0B1426; }
  svg[data-theme="light"] { --bg:#F7F4EC; --surface:#FFFFFF; --text:#0B1426; --muted:#5B6578; --rule:#C9CFDB; --primary:#0E9488; --danger:#D7333A; --success:#1B9E6A; --paper:#0B1426; --ink:#F4F1EA; }
  .bg { fill: var(--bg); }
  .t { fill: var(--text); font-family: "Inter", sans-serif; }
  .h { fill: var(--text); font-family: "Space Grotesk", sans-serif; font-weight: 500; }
  .m { fill: var(--muted); font-family: "JetBrains Mono", monospace; }
  .mt { fill: var(--muted); font-family: "Inter", sans-serif; }
  .rule { stroke: var(--rule); stroke-width: 1.5; }
  .strong { stroke: var(--text); stroke-width: 1.5; }
  .box { fill: var(--surface); stroke: var(--rule); stroke-width: 1.5; }
  .arrow { stroke: var(--text); stroke-width: 2; fill: none; marker-end: url(#head); }
  .arrow.soft { stroke: var(--muted); }
  .arrow.primary { stroke: var(--primary); marker-end: url(#headp); }
  .arrow.danger { stroke: var(--danger); marker-end: url(#headd); }
  .stamp { font-family: "Space Grotesk", sans-serif; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
</style>
<defs>
  <marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--text)"/></marker>
  <marker id="headp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--primary)"/></marker>
  <marker id="headd" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--danger)"/></marker>
</defs>
"""


def svg(body: str, w: int = W, h: int = H) -> str:
    # slide diagrams are drawn on an 80px margin and nudged in to the deck's 0.9in margin (108px of 1600)
    inner = body if w != W else f'<g transform="translate(28 16) scale(0.965)">{body}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" data-theme="dark">{STYLE}<rect class="bg" width="{w}" height="{h}"/>{inner}</svg>'


def patch(x: float, y: float, size: float, colour: str, seed: str, base: str = "var(--surface)", n: int = 4) -> str:
    cells = patch_cells(hash_seed(seed), n)
    tones = patch_colours(colour)
    c = size / n
    out = [f'<rect x="{x}" y="{y}" width="{size}" height="{size}" fill="{base}"/>']
    for (cx, cy, kind, rot, tone) in cells:
        if kind == "empty":
            continue
        px, py = x + cx * c, y + cy * c
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
    return "".join(out)


def stamp(x: float, y: float, text: str, colour: str = "var(--success)", size: int = 22, rot: float = -4, pad: float = 10) -> str:
    w = len(text) * size * 0.72 + pad * 2
    h = size * 1.5
    return (
        f'<g transform="rotate({rot} {x + w / 2} {y + h / 2})">'
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="{colour}" stroke-width="2.5"/>'
        f'<rect x="{x + 4}" y="{y + 4}" width="{w - 8}" height="{h - 8}" fill="none" stroke="{colour}" stroke-width="1"/>'
        f'<text class="stamp" x="{x + w / 2}" y="{y + h * 0.7}" font-size="{size}" fill="{colour}" text-anchor="middle">{text}</text></g>'
    )


def text(x, y, s, cls="t", size=22, anchor="start", extra=""):
    return f'<text class="{cls}" x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" {extra}>{s}</text>'


def lines(x, y, items, cls="t", size=20, gap=None):
    gap = gap or size * 1.45
    return "".join(text(x, y + i * gap, s, cls, size) for i, s in enumerate(items))


def running_head(x, y, w, left, right=""):
    return (
        f'<line class="strong" x1="{x}" y1="{y}" x2="{x + w}" y2="{y}"/>'
        + text(x, y + 30, left, "h", 22)
        + (text(x + w, y + 30, right, "m", 16, "end") if right else "")
    )


# ------------------------------------------------------------------ 1. architecture
def architecture() -> str:
    b = []
    b.append(running_head(80, 70, 1440, "Architecture", "Investec holds the rand · the chain holds the rulebook · the relayer carries messages"))
    cols = [(80, "Investec", "the money"), (600, "Relayer", "the messenger"), (1120, "Chain", "the rulebook")]
    for x, name, sub in cols:
        b.append(text(x, 150, name, "h", 34))
        b.append(text(x, 180, sub, "mt", 18))
    # Investec column
    b.append(f'<rect class="box" x="80" y="210" width="400" height="120"/>')
    b.append(text(100, 245, "Stokvel account", "h", 22))
    b.append(lines(100, 278, ["balance, transactions", "STK-03 references on credits"], "m", 15))
    b.append(f'<rect class="box" x="80" y="360" width="400" height="120"/>')
    b.append(text(100, 395, "Member cards", "h", 22))
    b.append(lines(100, 428, ["afterTransaction rounds up to R10", "transfermultiple to the pool"], "m", 15))
    b.append(f'<rect class="box" x="80" y="510" width="400" height="120"/>')
    b.append(text(100, 545, "Members' bank accounts", "h", 22))
    b.append(lines(100, 578, ["paymultiple on payout day", "saved beneficiaries"], "m", 15))
    # Relayer column: four loops
    b.append(f'<rect class="box" x="600" y="210" width="400" height="420"/>')
    b.append(text(620, 245, "Four loops, no database", "h", 22))
    loops = [
        ("contributions", "poll credits → recordContribution(id, cents, keccak(txId))"),
        ("reserves", "balance → attestor signs → postReserves"),
        ("payouts", "closeRound → PayoutDue → pay → confirmPayout"),
        ("votes", "HTTP: signed EIP-712 votes → voteBySig"),
    ]
    for i, (n, d) in enumerate(loops):
        y = 290 + i * 82
        b.append(f'<line class="rule" x1="620" y1="{y - 22}" x2="980" y2="{y - 22}"/>')
        b.append(text(620, y, n, "h", 19))
        b.append(text(620, y + 26, d, "m", 13.5))
    b.append(text(620, 610, "restart it any time: it re-reads bank and chain", "mt", 14))
    # Chain column
    b.append(f'<rect class="box" x="1120" y="210" width="400" height="230"/>')
    b.append(text(1140, 245, "Stokvel.sol", "h", 22))
    b.append(lines(1140, 278, ["members, paidCents, seen[ref]", "pot, unsettled, reserves", "round % 6 is the recipient", "votes by memberId, timelock", "holds no funds, ever"], "m", 15))
    b.append(f'<rect class="box" x="1120" y="470" width="400" height="160"/>')
    b.append(text(1140, 505, "Readers", "h", 22))
    b.append(lines(1140, 538, ["projector dashboard, signing station,", "audience phones: events only,", "verify on Basescan"], "m", 15))
    # arrows
    b.append('<path class="arrow primary" d="M480 270 L600 270"/>')
    b.append(text(540, 258, "poll", "m", 13, "middle"))
    b.append('<path class="arrow primary" d="M1000 270 L1120 270"/>')
    b.append(text(1060, 258, "write", "m", 13, "middle"))
    b.append('<path class="arrow soft" d="M1120 400 L1000 400"/>')
    b.append(text(1060, 388, "PayoutDue", "m", 13, "middle"))
    b.append('<path class="arrow soft" d="M600 570 L480 570"/>')
    b.append(text(540, 558, "pay", "m", 13, "middle"))
    b.append('<path class="arrow soft" d="M480 420 C 540 420, 540 300, 480 300" transform="translate(0,-40)"/>')
    b.append(text(520, 340, "round-up", "m", 13, "start"))
    # footer
    b.append(f'<line class="rule" x1="80" y1="700" x2="1520" y2="700"/>')
    b.append(text(80, 740, "Two keys. The relayer records what the bank did. The attestor signs what the bank holds. Neither can choose who gets paid.", "t", 20))
    b.append(text(80, 775, "Sandbox and testnet only. Mock mode mirrors the Investec sandbox on the laptop for the parts the stateless sandbox can't show.", "mt", 17))
    return svg("".join(b))


# ------------------------------------------------------------------ 2. the pattern
def pattern() -> str:
    b = []
    b.append(running_head(80, 70, 1440, "The pattern", "money stays in the bank · rules live on chain · the relayer is a messenger only"))
    cols = [
        (80, "Money", "Investec", "var(--text)", ["holds every rand", "pays members through the API", "the sandbox on stage, production in life"]),
        (580, "Rules", "Stokvel.sol", "var(--primary)", ["who paid, whose turn, what is owed", "refuses what the rules refuse", "public, cheap to read, never holds funds"]),
        (1080, "Messages", "the relayer", "var(--muted)", ["carries facts both ways", "signs nothing that decides anything", "kill it and restart it, nothing is lost"]),
    ]
    for x, big, who, col, ls in cols:
        b.append(text(x, 240, big, "h", 72, extra=f'fill="{col}"'))
        b.append(text(x, 285, who, "m", 20))
        b.append(f'<line class="rule" x1="{x}" y1="310" x2="{x + 440}" y2="310"/>')
        b.append(lines(x, 350, ls, "t", 21))
    # what the relayer can't do
    b.append(f'<line class="strong" x1="80" y1="520" x2="1520" y2="520"/>')
    b.append(text(80, 560, "What the messenger cannot do", "h", 26))
    cant = [("pick a recipient", "there is no setter; the order is the order"), ("repeat a payment", "seen[ref] makes every Investec id single use"), ("invent reserves", "the attestor is a different key"), ("outvote the members", "votes are card signatures, counted per member")]
    for i, (a, d) in enumerate(cant):
        x = 80 + i * 360
        b.append(stamp(x, 590, "cannot", "var(--danger)", 18))
        b.append(text(x, 680, a, "h", 24))
        b.append(text(x, 712, d, "mt", 16))
    b.append(text(80, 820, "“We didn't replace the trust. We wrote it down where nobody can erase it.”", "h", 26))
    return svg("".join(b))


# ------------------------------------------------------------------ 3. hash chain
def hash_chain() -> str:
    b = []
    b.append(running_head(80, 70, 1440, "Blockchain in 60 seconds", "each block carries the hash of the one before it"))
    blocks = [("#1", "Lerato paid R5,000", "9f2a"), ("#2", "Thabo paid R5,000", "3c71"), ("#3", "Aisha paid R5,000", "b04e"), ("#4", "Round 1 closed", "77d1"), ("#5", "Paid Lerato R30,000", "e6a9")]

    def row(y, tampered):
        for i, (n, what, h) in enumerate(blocks):
            x = 80 + i * 290
            bad = tampered and i >= 2
            stroke = "var(--danger)" if bad else "var(--text)"
            b.append(f'<rect x="{x}" y="{y}" width="240" height="150" fill="var(--surface)" stroke="{stroke}" stroke-width="2"/>')
            b.append(text(x + 16, y + 34, n, "h", 22, extra=f'fill="{stroke}"'))
            content = "Thabo paid R50,000" if (tampered and i == 1) else what
            b.append(text(x + 16, y + 68, content, "t", 17, extra=('fill="var(--danger)"' if tampered and i == 1 else "")))
            prev = "prev  0000" if i == 0 else f"prev  {blocks[i - 1][2]}"
            if tampered and i >= 2:
                prev = "prev  " + ("????" if i == 2 else "????")
            b.append(text(x + 16, y + 100, prev, "m", 14, extra=('fill="var(--danger)"' if bad else "")))
            hh = ("????" if (tampered and i >= 1) else h)
            b.append(text(x + 16, y + 126, f"hash  {hh}", "m", 14, extra=('fill="var(--danger)"' if (tampered and i >= 1) else "")))
            if i < len(blocks) - 1:
                cls = "arrow danger" if bad else "arrow"
                b.append(f'<path class="{cls}" d="M{x + 240} {y + 75} L{x + 288} {y + 75}"/>')

    b.append(text(80, 150, "Honest", "h", 24))
    row(170, False)
    b.append(text(80, 420, "Change one number in block #2", "h", 24, extra='fill="var(--danger)"'))
    row(440, True)
    b.append(stamp(1180, 620, "broken", "var(--danger)", 28))
    b.append(f'<line class="rule" x1="80" y1="720" x2="1520" y2="720"/>')
    b.append(text(80, 760, "Every block's hash covers the block before it. Rewrite one line and every later hash stops matching.", "t", 20))
    b.append(text(80, 795, "Thousands of computers hold the same chain, so the rewrite would have to fool all of them at once. That is what “nobody can erase it” means.", "mt", 17))
    return svg("".join(b))


# ------------------------------------------------------------------ 4. round lifecycle
def lifecycle() -> str:
    b = []
    b.append(running_head(80, 70, 1440, "A round, start to finish", "the contract's month"))
    steps = [
        ("1", "Contributions", "STK-nn credits land in the bank", "recordContribution", "AlreadyRecorded · AmountTooLarge"),
        ("2", "Attestation", "attestor signs the balance, every 20 s", "postReserves", "BadAttestation · ReservesStale"),
        ("3", "Close", "anyone calls it after month end", "closeRound", "RoundStillOpen · ReservesStale · ReservesShort"),
        ("4", "Payout due", "recipient is round % 6, no setter", "PayoutDue event", ""),
        ("5", "Bank pays", "relayer calls paymultiple", "Investec API", ""),
        ("6", "Confirmed", "with the bank's payment reference", "confirmPayout", "WrongBeneficiary · UnknownPayout"),
    ]
    for i, (n, name, what, fn, errs) in enumerate(steps):
        x = 80 + (i % 3) * 480
        y = 150 + (i // 3) * 300
        b.append(f'<rect class="box" x="{x}" y="{y}" width="440" height="240"/>')
        b.append(text(x + 20, y + 52, n, "h", 40, extra='fill="var(--primary)"'))
        b.append(text(x + 70, y + 46, name, "h", 26))
        b.append(text(x + 20, y + 92, what, "t", 18))
        b.append(text(x + 20, y + 130, fn, "m", 16))
        if errs:
            b.append(text(x + 20, y + 170, "refuses with", "mt", 14))
            b.append(text(x + 20, y + 196, errs, "m", 14, extra='fill="var(--danger)"'))
        if i in (0, 1, 3, 4):
            b.append(f'<path class="arrow" d="M{x + 440} {y + 120} L{x + 478} {y + 120}"/>')
    # 3 -> 4: down from the end of the top row, along the gutter, into the start of the bottom row
    b.append('<path class="arrow" d="M1300 390 L1300 420 L300 420 L300 448"/>')
    # 6 -> 1: out of the last box, round the left margin, back into the first
    b.append('<path class="arrow primary" d="M1300 690 L1300 740 L40 740 L40 270 L78 270"/>')
    b.append(text(700, 770, "next round opens, the recipient moves on by one", "m", 16, "middle", 'fill="var(--primary)"'))
    b.append(text(80, 850, "Money never touches the chain. The chain only says whether the bank may pay, and to whom.", "t", 20))
    return svg("".join(b))


# ------------------------------------------------------------------ 5. threat model
def threat_model() -> str:
    b = []
    b.append(running_head(80, 70, 1440, "Threat model", "every attack we try on stage, and what says no"))
    rows = [
        ("Dodgy treasurer", "“Pay me this month”", "no recipient setter; rotation changes need a vote plus timelock", "no setter"),
        ("Dodgy treasurer", "takes rand out of the account", "proof of reserves: ReservesShort freezes payouts", "frozen"),
        ("Compromised relayer", "records the same payment twice", "seen[ref] refuses it: AlreadyRecorded", "refused"),
        ("Compromised relayer", "invents a huge contribution", "AmountTooLarge cap, and reserves fall short at close", "capped"),
        ("Compromised relayer", "pays the wrong person", "beneficiaryHash check, public events, members vote it out", "checked"),
        ("Vote thief", "replays an old signed vote", "EIP-712 domain plus a per-signer nonce", "nonce"),
        ("Stolen member card", "votes as the victim", "social recovery: RotateKey moves the member to a spare card", "rotated"),
    ]
    b.append(text(80, 140, "attacker", "m", 14))
    b.append(text(420, 140, "attack", "m", 14))
    b.append(text(760, 140, "defence", "m", 14))
    b.append(f'<line class="rule" x1="80" y1="152" x2="1520" y2="152"/>')
    for i, (who, attack, defence, st) in enumerate(rows):
        y = 200 + i * 86
        b.append(text(80, y, who, "h", 21))
        b.append(text(420, y, attack, "t", 19))
        b.append(text(760, y, defence, "t", 17))
        b.append(stamp(1330, y - 26, st, "var(--success)" if st not in ("frozen", "refused") else "var(--danger)", 14, -3, 8))
        b.append(f'<line class="rule" x1="80" y1="{y + 30}" x2="1520" y2="{y + 30}"/>')
    b.append(text(80, 850, "Not enforced, and said out loud: the relayer is trusted to report what the bank did, and the attestor to sign the real balance. Both can be voted out.", "mt", 17))
    return svg("".join(b))


# ------------------------------------------------------------------ hero
def hero() -> str:
    w, h = 1600, 800
    b = []
    # quilt border down the left, a column of member patches
    for i, (num, name, col) in enumerate(MEMBERS):
        b.append(patch(0, i * 133.4, 133.4, col, f"member:{num}:hero"))
    b.append(text(210, 150, "Investec developer community · Q4 2026", "m", 18))
    b.append(text(210, 265, "The Treasurer", "h", 96))
    b.append(text(210, 370, "Is a Smart Contract", "h", 96))
    b.append(text(210, 430, "Rebuilding the stokvel with Solidity and Investec Programmable Banking", "t", 26))
    b.append(text(210, 470, "Investec holds the rand. The chain holds the rulebook. The relayer carries messages and can't decide.", "mt", 20))
    # a stylised page of the ledger
    x0, y0 = 210, 530
    b.append(f'<line class="strong" x1="{x0}" y1="{y0}" x2="{x0 + 1300}" y2="{y0}"/>')
    b.append(text(x0, y0 + 30, "Investec · The Q4 Stokvel", "h", 18))
    b.append(text(x0 + 1300, y0 + 30, "page 1 of 2", "m", 14, "end"))
    rows = [("23/11", "STK-04", "R5,000.00"), ("23/11", "STK-03", "R5,000.00"), ("23/11", "Stokvel payout to Thabo", "−R30,000.00")]
    for i, (d, ref, amt) in enumerate(rows):
        y = y0 + 70 + i * 40
        b.append(text(x0, y, d, "m", 15))
        b.append(text(x0 + 110, y, ref, "t", 19))
        b.append(text(x0 + 700, y, amt, "m", 19, "end"))
        b.append(f'<line class="rule" x1="{x0}" y1="{y + 12}" x2="{x0 + 700}" y2="{y + 12}"/>')
    b.append(text(x0 + 780, y0 + 100, "Pot, round 3", "mt", 16))
    b.append(text(x0 + 780, y0 + 150, "R20,000.00", "h", 48))
    b.append(stamp(x0 + 1080, y0 + 100, "covered", "var(--success)", 20))
    b.append(text(x0 + 780, y0 + 195, "← this month's payout: 03 Aisha", "h", 16, extra='fill="#E76F51"'))
    return svg("".join(b), w, h)


DIAGRAMS = {
    "architecture": architecture,
    "pattern": pattern,
    "hash-chain": hash_chain,
    "round-lifecycle": lifecycle,
    "threat-model": threat_model,
    "hero": hero,
}

if __name__ == "__main__":
    for name, fn in DIAGRAMS.items():
        (HERE / f"{name}.svg").write_text(fn())
        print("wrote", name + ".svg")
