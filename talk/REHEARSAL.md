# Rehearsal

Three rehearsals, in this order, at least a week apart from the last one and the event. Each one
has a different job. Log the timings in the table at the bottom every time.

## Rehearsal 1: the words (alone, no laptop)

Read `SPEECH.md` out loud, standing, with a timer. Don't stop for demos: say the demo cue line and
count ten seconds in your head. The target is 19 to 20 minutes of talking without demos, because
the demos add about five. If you're over, cut sentences, not sections; the ✂️ marks are for the
day, not for this.

What you're learning: which lines are yours and which lines are the script's. Rewrite the ones
that don't sound like you.

## Rehearsal 2: the machine (alone, full stack)

```bash
./scripts/demo.sh --mock
```

Put the projector page on one screen, the presenter panel on another, and the signing station on
a third window (or a second laptop, which is how it'll be on the night). Run every demo from the
presenter panel in run-sheet order, saying the script, with the timer running. Then do it again
with the stage app in fallback mode (`/?fallback=1`) so you know what the recorded path looks
like.

Things that go wrong in this rehearsal, in the order they usually do:

- The signing station's USB scanner types into the wrong window. Click the station first; it
  listens to the page, not to an input box.
- The webcam path needs HTTPS or localhost. On the night, use the USB scanner.
- You press "Skip to month end" before everyone has paid. The round closes with a smaller pot.
  Fine: it's a stokvel, not everyone pays on time. Say so.
- The relayer is mid-restart when you press a button. Wait for "relayer up" in the header.
- The presenter panel and the dashboard show different contribution amounts for a second. The
  dashboard polls every two seconds; wait.

## Rehearsal 3: the room (with people)

Six friends, six printed cards, a real projector, your own hotspot, the clicker. Run the whole
talk end to end once, no stopping. Have someone time each segment against the run sheet and write
the numbers in the table. Then do the two hardest demos again: the vote (four people at one
scanner takes longer than you think) and the stolen card (the theatre of it needs a beat).

Ask them afterwards, in this order: what was the one sentence they'd tell someone tomorrow, where
did they get lost, and where were they bored. Cut the bored part.

## Timing log

Fill one column per rehearsal. The target column is the run sheet.

| # | Segment | Target | R1 | R2 | R3 | Day |
|---|---|---|---|---|---|---|
| 1 | Title | 0:30 | | | | |
| 2 | Hook | 1:00 | | | | |
| 3 | Scale | 1:00 | | | | |
| 4 | Single point of trust | 1:00 | | | | |
| 5 | The pattern | 1:00 | | | | |
| 6 | Blockchain in 60 seconds | 1:00 | | | | |
| 7 | DEMO 1: the committee | 1:30 | | | | |
| 8 | DEMO 2: swipe and round-up | 2:00 | | | | |
| 9 | The whole payout rule | 1:00 | | | | |
| 10 | DEMO 3: month end | 2:00 | | | | |
| 11 | DEMO 4: the treasurer steals | 2:00 | | | | |
| 12 | DEMO 5: double webhook | 2:00 | | | | |
| 13 | DEMO 6: the fuzzer ✂️ | 1:30 | | | | |
| 14 | DEMO 7: vote | 2:00 | | | | |
| 15 | DEMO 8: stolen card | 2:30 | | | | |
| 16 | Kill the server ✂️ | 1:00 | | | | |
| 17 | Honest limits and what's next | 1:00 | | | | |
| 18 | Close | 1:00 | | | | |
| | **Total** | **25:00** | | | | |

The 20 minute cut: drop 13 and 16 (2:30), the show of hands in 2 (0:30), the optional beats in 12
and 15 (1:00), and the "honest note" about the stateless sandbox in 8 (0:30). Move that last one
into the honest limits slide if you cut it; it should be said somewhere.

## Common failure points

| Where | What happens | What to do |
|---|---|---|
| DEMO 1 | A volunteer's card won't scan | Type the key from the card's back into the paste box, or use the presenter's "signs" button for that member and say "the station's doing it for her" |
| DEMO 2 | The R3 line lands but no chain event | The relayer is down. Look at the header. Wait for "relayer up", the poll catches it |
| DEMO 3 | "RoundStillOpen" after skipping | You're on Base Sepolia, not Anvil. Time can't move. Say when the round ends and come back to it, or switch the dashboard to fallback |
| DEMO 4 | No red screen | The alarm shows for nine seconds, then clears. Press "Try to close the round" again |
| DEMO 5 | V2 doesn't refuse | The latest credit was already sent twice. Make a fresh contribution first (any "pays" button), then replay |
| DEMO 7 | A vote is refused with BadNonce | The card already voted. The station shows "of 6 have signed"; pick another volunteer |
| DEMO 8 | The thief's card is still a member | The rotate proposal hasn't executed. Check the timelock countdown on the presenter's Execute button |
| Any | The projector page is blank | Reload. It rebuilds from the chain in two seconds. If the chain is gone, fallback mode |
