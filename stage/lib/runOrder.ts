/**
 * The talk's demos in run-sheet order (talk/SPEECH.md), as the run sheet shows them: what to type,
 * and what happens in between. A step is either a command to type or a cue for the room.
 */
export type RunStep = { cmd: string; note?: string } | { cue: string };
export type RunDemo = { demo: string; title: string; steps: RunStep[] };

export const RUN_ORDER: RunDemo[] = [
  {
    demo: "DEMO 1",
    title: "The committee",
    steps: [
      { cmd: "zoom constitution", note: "the rules, and six empty signature lines" },
      { cue: "The six volunteers point their phone camera at the back of their card, tap the link, read the slip, press Sign. Each signature lands on its line; the sixth brings up \"Everyone has signed the constitution\"." },
      { cmd: "zoom all" },
    ],
  },
  {
    demo: "DEMO 2",
    title: "Swipe and round-up",
    steps: [
      { cmd: "swipe aisha 87", note: "R87 at the bakery: R3 lands as STK-03" },
    ],
  },
  {
    demo: "before DEMO 3",
    title: "Everyone pays",
    steps: [{ cmd: "pay all", note: "six PAID stamps" }],
  },
  {
    demo: "DEMO 3",
    title: "Month end",
    steps: [{ cmd: "monthend", note: "the round closes, Aisha is paid, the pot goes to zero" }],
  },
  {
    demo: "DEMO 4",
    title: "The treasurer steals",
    steps: [
      { cmd: "pay all", note: "the new month" },
      { cmd: "steal 1000", note: "Admin fees, then Short R1,000" },
      { cmd: "close", note: "FROZEN" },
      { cmd: "putback", note: "the money goes back and the round closes" },
    ],
  },
  {
    demo: "DEMO 5",
    title: "Double webhook",
    steps: [
      { cmd: "double v1", note: "V1 counts it twice" },
      { cmd: "double v2", note: "V2: REFUSED, AlreadyRecorded" },
    ],
  },
  {
    demo: "DEMO 6 ✂",
    title: "The fuzzer (optional)",
    steps: [{ cue: "In a terminal on the laptop: ./scripts/fuzz.sh. V1 fails in two calls; V2 holds." }],
  },
  {
    demo: "DEMO 7",
    title: "Vote",
    steps: [
      { cmd: "propose raise", note: "R5,000 to R6,000" },
      { cue: "Any four volunteers scan their card again and sign the vote on their phone." },
      { cmd: "execute", note: "skips the timelock on this chain" },
    ],
  },
  {
    demo: "DEMO 8",
    title: "Stolen card",
    steps: [
      { cmd: "propose rotate", note: "Sipho, 06, to the spare card 06b" },
      { cue: "Hand Sipho card 06b. Four volunteers sign the vote on their phones." },
      { cmd: "execute" },
      { cue: "The thief (you) scans the old card 06 with a phone: Not a member. Sipho scans 06b: it works." },
    ],
  },
  {
    demo: "DEMO 9 ✂",
    title: "Kill the server (optional)",
    steps: [
      { cmd: "kill", note: "wait about 10 seconds before the next command" },
    ],
  },
  {
    demo: "Close",
    title: "The quilt",
    steps: [{ cmd: "zoom quilt" }],
  },
];

/** Rehearsing alone, without volunteers: the commands that stand in for the phones. */
export const REHEARSAL_STANDINS: Record<string, string> = {
  "DEMO 1": "join all",
  "DEMO 7": "vote all",
  "DEMO 8": "vote all",
};
