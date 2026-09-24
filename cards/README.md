# cards

Physical member cards for the six volunteers, two spares, and the treasurer. Each card carries a
throwaway testnet key as a QR on the back; the signing station scans it, signs one message, and
forgets it.

```bash
pip install -r requirements.txt
python3 generate.py            # real keys: out/cards.pdf, out/keys.json, out/members.json (gitignored)
python3 generate.py --preview  # fake keys: previews into ../assets/cards/
```

`out/cards.pdf` is print ready: 85.6 x 54 mm cards with 3 mm bleed and crop marks, eight to an A4
sheet, fronts on one page and backs mirrored on the next for long-edge duplex. Ask the print shop for
350 gsm, matt laminate, rounded corners. Order two weeks before the talk (see
`talk/EVENT_CHECKLIST.md`).

`out/members.json` feeds the contract deployment so the printed keys are the members:

```bash
cd ../contracts
MEMBERS_FILE=../cards/out/members.json forge script script/Deploy.s.sol --rpc-url anvil --broadcast
```

`scripts/demo.sh` picks that file up on its own when it exists.

The keys have no value anywhere real, but the card still says "Keys are cash" because the habit is
the point: the audience should see people treating a key like a note in a wallet. After the talk,
cut the cards up or keep them as souvenirs; either way, never reuse the keys.

The quilt patch on each card is drawn by the same algorithm as the dashboard (`stage/lib/quilt.tsx`,
ported to Python here), so member 03's card shows the same patch that appears next to Aisha on
the projector.
