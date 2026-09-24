# Event checklist

## Hardware

- [ ] Laptop, charged, power brick, with the whole repo cloned and `./scripts/demo.sh --mock`
      run successfully that morning
- [ ] Second laptop or tablet for the signing station (`/sign` on the hotspot IP), charged
- [ ] USB QR scanner (keyboard wedge type, any brand that "types" what it scans), tested against a
      printed card
- [ ] Clicker, spare batteries
- [ ] Own 4G hotspot, tested in the venue if you can; the laptop and the signing device join it,
      never the venue wifi
- [ ] HDMI and USB-C adapters for the venue's projector, plus a spare
- [ ] A long HDMI cable in case the lectern is far from the screen
- [ ] Headphone jack or audio adapter if the recording has sound

## Printing (order two weeks ahead)

- [ ] `cards/out/cards.pdf` printed at a real print shop: 85.6 x 54 mm, 350 gsm, matt laminate,
      rounded corners, cut on the crop marks. Nine cards: 01 to 06, 04b, 07, T
- [ ] Proof one card before the run: the QR must scan from 20 cm with the phone camera
- [ ] A second set printed from a second `generate.py` run, kept sealed, in case a card is lost
      before the night (a lost card means a different deployment, so keep the two sets apart)
- [ ] Six lanyards or card holders so the volunteers don't put the cards in their pockets and
      forget them

## Props

- [ ] The treasurer hat. Anything obviously a hat. It goes on the person playing the dodgy
      treasurer in DEMO 4
- [ ] A small stand or tape to hold the scanner still at the signing station
- [ ] Printed run sheet (the table in `SPEECH.md`) on the lectern

## Accounts and keys

- [ ] Investec sandbox credentials in `relayer/.env` (and `card/env.json` if you demo the card
      IDE). From developer.investec.com, SA PB Account Information, Sandbox section. Never
      production
- [ ] `npm run smoke:sandbox` run once this week and the result pasted into
      `docs/INVESTEC_API_NOTES.md`
- [ ] If you're using Base Sepolia: the deployer, relayer and attestor keys funded from a faucet,
      the contracts deployed with `FIRST_ROUND_ENDS_AT` set to about twelve minutes into the talk,
      verified on Basescan, and the addresses in `contracts/deployments/84532.json`
- [ ] Decide the night's mode and say it out loud to yourself: **mock** (recommended, no network)
      or **Base Sepolia + mock bank** (audience can verify on Basescan; needs the hotspot to hold)
- [ ] The card keys in `cards/out/` match the deployment (`demo.sh` reads `members.json` on its own)

## The safety line

Said once, out loud, before DEMO 1, every time:

> "Everything you see tonight is the Investec sandbox and a test network. There is no real money
> here and no real person's data."

## Timeline for the day

| When | What |
|---|---|
| Morning | Fresh clone, `./scripts/demo.sh --mock`, every demo once from the presenter panel. Charge everything |
| 2 hours before | Arrive. Projector: plug in, fullscreen the dashboard, check it reads from the back row. Fix the font size in the browser zoom if it doesn't |
| 90 minutes before | Hotspot up, laptop and signing device on it. Scanner test with card 01 on the signing station. Fallback mode toggled on and off once |
| 60 minutes before | Restart the stack clean (`Ctrl-C`, then `./scripts/demo.sh --mock`). Leave it running. Don't touch the presenter panel again until the talk |
| 30 minutes before | Cards, lanyards, hat and run sheet on the lectern. Recording open on the desktop, paused at chapter 1 |
| 10 minutes before | Pick six volunteers if the organiser lets you, so the DEMO 1 handout is quick |
| 0:00 | Card in hand. Walk on |
| 25:00 | Closing line, repo QR, thank the volunteers by name |
| After | Collect the cards, or let them keep them and say so. Either way the keys are done with |

## Numbers to have in your head

- 11 million members, 810,000 stokvels, about R50bn a year (NASASA via EWN, August 2025)
- R5,000 contribution, R30,000 pot, six members, round three on the night
- Timelock 120 seconds on stage, 48 hours in the story
- Reserves must be under an hour old; the relayer attests every 20 seconds in demo mode
