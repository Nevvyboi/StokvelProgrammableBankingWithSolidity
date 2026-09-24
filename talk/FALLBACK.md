# Fallback

Every demo has a second path. The rule on stage: one sentence ("that's the live path, the recorded
one is behind it"), one keypress, carry on. Never apologise twice, never debug in front of the
room.

## The three layers

1. **Mock mode** (`./scripts/demo.sh --mock`). This is the default and the recommended way to run
   the night. Everything is on the laptop: Anvil, the mock Investec, the relayer, the stage app.
   No internet needed. If you were running against Base Sepolia or the sandbox and it dies, this
   is the first fallback: stop, run the mock, you're back in ninety seconds.
2. **Fallback mode on the dashboard.** The presenter panel's "Switch the dashboard to fallback
   mode" button (or `/?fallback=1`). The projector page loads a snapshot of the seeded state and
   the presenter steps through a script of all eight demos with "Next fallback step". Stamps, feed
   lines, ledger changes and the quilt all play; nothing needs a backend. Use this when Anvil or
   the relayer is broken and you don't have ninety seconds.
3. **The recording.** Record rehearsal 3's projector screen (QuickTime or OBS, 1080p) and keep it on
   the desktop as `stokvel-demos.mp4`, with chapter marks at each demo. If the laptop itself is
   the problem, the deck's demo slides say what the audience is about to see; play the chapter.

## Per demo

| Demo | If it fails | Exact action |
|---|---|---|
| 1 committee | A card won't scan | Presenter panel, DEMO 1, that member's "signs" button. Or the paste box on `/sign` with the key typed from the card |
| 1 committee | The relayer refuses (NotMember) | Wrong deck of cards for this deployment. Use "all six" on the presenter panel (it uses the deployed keys) and carry on; the cards still work for the vote story if you swap to the presenter's vote buttons |
| 2 swipe | Nothing lands on the statement | Presenter, "before DEMO 3": any "pays" button posts a plain credit with the reference. Say "the card code's in the repo, this is the same transfer by hand" |
| 2 swipe | The chain event never comes | Header says relayer down. Wait five seconds. If still down, fallback mode step 2 |
| 3 month end | RoundStillOpen | On Anvil: press "Run the loops now" once more. On Base Sepolia: fallback mode step 4 |
| 3 month end | Payout never settles | Mock bank is down. Fallback mode step 4 |
| 4 theft | No red screen | Alarms clear after nine seconds. Press "Try to close the round" again. Or fallback step 5 |
| 5 double webhook | V2 records instead of refusing | The replayed credit was new. Post a "pays" credit, wait for it to be recorded, then press V2 again. Or fallback step 6 |
| 6 fuzzer | Terminal hangs | Skip it. It's a ✂️ segment. The slide shows the failing output as a screenshot |
| 7 vote | Signing station dead | Presenter panel, DEMO 7, the four "votes" buttons. Pre-signed votes, same signatures the cards would produce. Say "the station's signing for them" |
| 7 vote | Execute says TimelockActive | Wait for the countdown on the button, or on Anvil press Execute again (it warps first) |
| 8 stolen card | The old card still signs | The rotate hasn't executed. Press Execute. If the proposal never got four votes, use the presenter's vote buttons |
| 9 kill the server | The relayer doesn't come back | It's a ✂️ segment. Say "it comes back on its own in rehearsal, and it's on the slide", move on |

## Pre-signed votes

For DEMO 7 and DEMO 8 the presenter panel can sign as any member using the keys in
`cards/out/keys.json`. The signatures are real EIP-712 signatures, identical to what the cards
produce, so the contract path is the same. If the stack was started without printed cards, it
uses Anvil's public test accounts as the members and the panel signs with those.

## The order of switching

1. The demo fails once. Say the line. Press the button that does the same thing from the presenter
   panel (the table above).
2. That fails too. Switch the dashboard to fallback mode and step the script.
3. The laptop is the problem. Open the recording at the chapter for this demo.
4. Everything is the problem. The deck stands alone: every demo slide has a one-line promise and a
   screenshot of the state it produces. Talk to the screenshots. The story survives.

## Before you walk on

- `./scripts/demo.sh --mock` running, all four URLs answering.
- The projector page open in a full-screen browser, presenter panel on the second screen.
- Fallback mode tested once today: toggle on, step twice, toggle off, reload.
- The recording on the desktop, chapter marks checked.
- Phone hotspot on, laptop connected to it, not the venue wifi.
