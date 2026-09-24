# The Treasurer Is a Smart Contract

### Speaker script, timed slide by slide

**Runtime:** 25 minutes, then 5 minutes of questions. About 3,100 spoken words at 130 words a
minute, with the rest of the time inside the demos. Segments marked ✂️ can be dropped for a 20
minute slot; together they take out five minutes.

**How to use this:** the deck carries the short notes (press N in the HTML deck, or read the notes
pane in PowerPoint). This is the full version to rehearse out loud. Stage directions are in
*italics*. Demo cues are in `code` and match the buttons on `/presenter`. Lines marked ★ are the
ones to keep even when everything else goes sideways. Don't read it word for word on the night.

The safety line, said once, out loud, before the first demo: "Everything you see tonight is the
Investec sandbox and a test network. There is no real money here and no real person's data."

---

## 1 · 0:00 · Title

*Walk on with one member card in your hand. Hold it up. Let the room see it before you speak.*

Evening, everybody. Howzit.

*Hold the card a moment longer.*

This is a stokvel membership card. Six of you are going to get one of these in a few minutes.
And by the end of this talk, this card is going to get stolen.

*Pocket it.*

I'm Nevin. I'm a data engineer, I'm doing my MSc at night, and I build things on Programmable
Banking that my friends think are slightly unhinged. Tonight's one is called *The Treasurer Is a
Smart Contract*.

---

## 2 · 0:30 · Hook

*Slide shows the fictional WhatsApp thread. Read it in the voice of someone who's been holding
that question in for a week.*

"Guys. Where's December's money."

*Beat.*

"Guys?"

*Beat.*

That little face at the end. Every South African knows that face.

★ If you have ever been in a stokvel, or your mother has, or your aunt runs one, you know exactly
what happened here. Somebody has a spreadsheet. Somebody has the banking app. Somebody's cousin
needed a small loan in November. And now it's December, and the question in the group has no
answer.

*✂️ Show of hands. Skip this if you are tight on time.*

Quick show of hands. Who here is in a stokvel? Keep them up. Who is in one where you personally
have never seen the bank statement? *Look around.* Ja. That's the talk.

---

## 3 · 1:30 · Scale

*The three numbers land one at a time.*

Let's be honest about how big this is, because I think in a room of developers we underrate it.

Eleven million members. Eight hundred and ten thousand stokvels. Roughly fifty billion rand a
year. That's NASASA's count from August last year, and it's on the slide so you can check me.

Fifty billion rand, moving every year, on trust. Not on contracts. Not on software. On the fact
that Thandi is a good person and everybody knows her.

And the thing is, Thandi usually is a good person. That's not the problem. The problem is that
the whole system only works when she is.

---

## 4 · 2:30 · Single point of trust

*The diagram: ledger, money and rules, all with arrows into one person.*

Look at where everything goes. The ledger, who paid what, lives in the treasurer's head or in
her notebook. The money lives in the treasurer's bank account, because the group needs an
account and it's easier if it's hers. And the rules, whose turn it is, what happens if you're
late, live in the WhatsApp group. Which the treasurer admins.

One person. Three jobs. No audit trail.

Now here's what I want you to notice. Investec doesn't sell a stokvel account. FNB does,
Standard Bank does, Nedbank does. Investec doesn't. And I'm going to argue tonight that with
Programmable Banking, it doesn't need to. Because the interesting bit was never the account.
The interesting bit is the treasurer.

---

## 5 · 3:30 · The pattern

*The diagram with three words: Money, Rules, Messages.*

★ Here's the whole idea in one sentence. Investec holds the rand. The blockchain holds the
rulebook. And a small program called a relayer carries messages between them, and it is not
allowed to make decisions.

Three pieces. What matters is what each one can't do.

The bank holds every cent. Nothing on the chain ever holds money. There is no token, there is no
coin, there's nothing to buy. If you came here for crypto, I'm sorry, there's wine at the back.

The contract holds the record and the rules. Who paid. Whose turn it is. What the club is owed.
And it refuses anything that breaks a rule. We'll make it refuse a lot tonight.

And the relayer, the messenger, reads the bank and tells the chain, reads the chain and tells the
bank. It cannot choose who gets paid. It cannot invent a balance. And if it lies, the contract
catches it, and the members can vote it out.

---

## 6 · 4:30 · Blockchain in 60 seconds

*The hash chain animates: five blocks, then the second one changes and the rest go red.*

I'm going to do blockchain in one minute, and then I'm never going to say the word "blockchain"
again, because I know it makes some of you tired.

A chain is a list of records where each record carries a fingerprint of the one before it. That
fingerprint is a hash. Change one number in block two, and block two's fingerprint changes, and
block three was carrying the old one, so now three is wrong, and four, and five. Everything
after the edit breaks.

*Point at the red row.*

Then you give the same list to thousands of computers, so that to change one line you'd have to
fool all of them at once.

That's it. That's the whole property we want. Not money. Not tokens. Just a notebook that
nobody can quietly rewrite. A treasurer's book, kept in public.

---

## 7 · 5:30 · DEMO 1: the committee

*Pick up the stack of six cards. This is the safety line moment.*

Right. Volunteers. I need six people who are prepared to be in a stokvel with strangers for
twenty minutes.

*Hand out the cards as they come up. Read the names off the cards: Lerato, Thabo, Aisha, Johan,
Priya, Sipho. Give each person their number.*

Before anything moves: everything you see tonight is the Investec sandbox and a test network.
There is no real money here and no real person's data. These names are made up. These keys are
worth nothing. Treat the card like cash anyway, because that's the habit we're teaching.

*Turn to the projector.*

This is the treasurer's book. Left page, the Investec account. Right page, the chain. Both of
them live, both of them public.

*Point at the signing station.*

Lerato, come and be first. Turn your card over, hold the QR to the scanner.

`Signing station: scan card 01. The slip shows "Lerato signs the constitution of The Q4
Stokvel." Press Sign.`

Look at the sentence. Not a hex string. English. That's what her card is signing, and the
contract only accepts it because that card is member one. Press the button.

*Wait for the minute book line: "Member joined".*

And there it is on the right page. Nobody typed her name in. The chain knows her from the
signature.

*Get the other five through the station quickly. Talk over it.*

While the rest of the committee signs, everybody else: scan the QR on the screen. That's the
audience page. Read only, same as the projector, and every line links to the block explorer. You
don't have to take my word for any of this.

---

## 8 · 7:00 · DEMO 2: swipe and round-up

*Aisha's turn. The card in her hand is the stokvel card; the swipe is on the card simulator.*

Aisha, you're going to buy something. R87 at the bakery.

`Presenter: DEMO 2, "Aisha swipes R87 at the bakery".`

That button runs the actual card code, the file called main.js, the way Investec's card runtime
would run it. It's about sixty lines, and it's in the repo. After the transaction goes through,
it rounds the amount up to the next ten rand, so R87 becomes R90, and it transfers the R3
difference to the stokvel account with a reference. STK dash zero three. Member three.

*Watch the left page. The STK-03 line lands.*

There's the R3 on the statement. Now watch the messenger.

*The minute book: "bank → chain, Contribution recorded".*

The relayer polled the account, saw a credit with a stokvel reference, and told the contract:
member three paid three hundred cents, and here's the fingerprint of the bank transaction. The
contract wrote it down. And look at the quilt.

*The new patch appears.*

Every contribution adds a patch in that member's colour. It's a small thing, but I want the
group's history to look like something the group made.

If you're on the audience page, that event has a hash. Tap it. That's the contract, on a public
test network, telling you what just happened, without me in the way.

One honest note, because this is a room that will ask. Investec's sandbox is stateless. A
transfer in the sandbox returns a real payment reference and then nothing changes. So on stage
the money moves in a mirror of the sandbox that speaks the same API, byte for byte, and every
payout is also sent to the real sandbox, which answers with a real reference. You'll see one
later. The relayer can't tell the difference, and that's the test.

---

## 9 · 9:00 · The whole payout rule

*The code slide: closeRound, with the three checks highlighted and the rest dimmed.*

This is the entire payout rule. One function. Twelve lines that matter.

*Point at each line as you go.*

First: are the reserves fresh? The bank balance, signed by a separate key, no older than an hour.
If not, ReservesStale. Second: does the bank hold at least what the club is owed? If not,
ReservesShort. Third: is the month actually over? If not, RoundStillOpen.

And then the line I care about most.

*Highlight recipient = round % members.length.*

★ The recipient is the round number, modulo six. That's it. There is no function anywhere in
this contract that takes a recipient as an argument. Nobody can pay themselves. Not the
treasurer, not me, not the person who deployed it. The order is the order.

---

## 10 · 10:00 · DEMO 3: month end

*Everyone else pays first. Do it quickly, it's not the show.*

Let's get everybody paid up for the month.

`Presenter: "before DEMO 3", click through the remaining members.`

*Roster fills with PAID stamps.*

Six stamps. Thirty thousand and three rand in the pot, because Aisha's bakery run counts. And
the reconciliation line says the bank holds exactly that, signed. Covered.

Now, it's the twenty-third of December, and I can't make you sit here until then, so on this
local chain I'm allowed to move the clock.

`Presenter: DEMO 3, "Skip to month end and settle".`

*Talk through the minute book as the lines arrive.*

Clock moved. The round is over. The relayer asks the contract to close, the contract checks the
three things, and it says: pay member three. Aisha. Payout due.

The relayer calls the Investec payments API, paymultiple, with Aisha's saved beneficiary.

*Left page: the debit lands, the balance drops to zero.*

And there's the money leaving the account. Thirty thousand and three rand to Aisha. The bank
gives back a payment reference, and the relayer tells the contract: paid, here's the reference.
Payout settled. The pot is zero, and the roster has moved on. Johan is next.

*Turn to Aisha.*

Congratulations. It's testnet money, but the feeling is real.

---

## 11 · 12:00 · DEMO 4: the treasurer steals

*Pick up the treasurer hat. Put it on someone. If you can, put it on yourself.*

Now, I need a treasurer. The treasurer is the person with the login to the Investec account.
That's a normal bank account. Nothing on any chain can stop the signatory from moving money. So
what happens when they do?

*Get the next month paid quickly, then steal.*

`Presenter: "before DEMO 3" buttons again for the new month, then DEMO 4, "Take R1,000 out,
then attest".`

I've just moved a thousand rand from the stokvel account to my personal account, and I've
labelled it "Admin fees". Very professional.

*Left page: the debit line, "Admin fees".*

Now. The attestor, that separate key, signs the balance every twenty seconds. Watch the
reconciliation.

*Right page: "Short R1,000.00" stamp goes red.*

Bank holds twenty-nine thousand. Club is owed thirty. Short. And now let's try to close the
month.

`Presenter: DEMO 4, "Try to close the round".`

*The screen goes red. FROZEN.*

★ Frozen. No payout. The contract will not release a cent while the bank holds less than the
club is owed. Not because I'm honest. Because it checked.

And every member is looking at this on their phone. There's no version of this where December's
money goes missing quietly.

*Take the hat off.*

`Presenter: DEMO 4, "Put it back".`

The money goes back, the next attestation shows it, the round closes. The club moves on. The
treasurer, we'll deal with later.

---

## 12 · 14:00 · DEMO 5: double webhook

*This one is about the relayer being wrong, not the treasurer being bad.*

The relayer is software, and software repeats itself. Retries, timeouts, a bug. What happens if
the bank tells the relayer about the same transaction twice?

*The slide shows the one-line diff between V1 and V2.*

This is version one of the contract, from a few weeks ago, and version two. The difference is
one line. In version one, this line isn't there.

*Point at `if (seen[investecRef]) revert AlreadyRecorded(investecRef);`*

Let's see what one line is worth. Version one first.

`Presenter: DEMO 5, "V1: same transaction twice".`

Same bank transaction, sent twice. Version one records it twice. Priya has now paid ten thousand
rand this month according to the chain, and five according to the bank. Two months from now,
she'd be paid out of money that doesn't exist.

Version two.

`Presenter: DEMO 5, "V2: same webhook twice".`

*The screen goes red. REFUSED.*

First one lands. Second one: AlreadyRecorded. The contract has seen that transaction
fingerprint before, and it will never accept it again. The relayer didn't have to be clever. It
just had to be stopped.

✂️ *Optional: read the error out loud.* That hash on the screen is the fingerprint of the
Investec transaction. It's what makes the contract's memory of the bank exact, one line per rand
that ever moved.

---

## 13 · 16:00 · ✂️ DEMO 6: the fuzzer

*This whole segment is a cut. If you keep it, keep it fast.*

I found that bug in version one the boring way. I let a machine play ten thousand random months
against the contract.

`Terminal: ./scripts/fuzz.sh`

This is Foundry's invariant fuzzer. It calls the contract in random orders with random numbers:
contributions, duplicate webhooks, theft, refunds, time travel, closes, payouts. After every call
it checks four things that must always be true. The sum of what members paid equals the total.
Money in minus money out equals the pot. No transaction is ever counted twice. And the round
never closes while the bank is short.

*The suite fails. Point at the two-call reproduction.*

Version one breaks in seconds, and it hands me the shortest sequence that breaks it. Two calls.
Contribute, then the same webhook again. That's the reproduction I showed you a minute ago. The
same suite against version two: ten thousand calls, all four invariants hold.

If you take one engineering thing home tonight, take this. Write down what must always be true.
Let a machine try to make it false.

---

## 14 · 17:30 · DEMO 7: vote

*Back to the committee.*

The stokvel wants to raise the contribution. Five thousand to six. In a WhatsApp group this is
a forty-message argument. Here it's a signature.

`Presenter: DEMO 7, "Propose R5,000 to R6,000".`

*Turn to the volunteers.*

I need four of you at the signing station. Any four. Scan your card, read the sentence, press
Sign.

*As the first slip shows:*

Read it out for me, Thabo. *"Thabo approves: raise the contribution from R5,000 to R6,000."*
That's the message. Not a hash, not a transaction blob. A sentence a person can read before they
agree to it. And nobody's paying for gas: the card signs, the relayer pays.

*After the fourth vote: "majority reached, timelock started".*

Four of six. Strict majority. And now: nothing happens. Deliberately. There's a timelock. On
stage it's two minutes. In real life I'd set it to forty-eight hours, so a change that a majority
signed at eleven at night can still be looked at in the morning.

*Skip the timelock and execute.*

`Presenter: DEMO 7, "Execute".`

Executed. The contribution is six thousand. And that same vote signed twice? Let's not even try
it, there's a nonce in the signature, the second copy is dead on arrival. We tested it.

---

## 15 · 19:30 · DEMO 8: stolen card

*Walk over to Sipho. Take the card. Make it a little theatrical.*

Sipho. I'm so sorry. Your card's been stolen.

*Hold it up. This is the card from the opening line.*

This is the card I held up at the start. It's now in the hands of a thief, and the thief can
sign as Sipho. In most crypto systems, that's the end of the story. Lose your key, lose
everything.

Here, the committee can move Sipho's membership to a new card. Not the thief, the members.

`Presenter: DEMO 8, "Propose RotateKey 06 to 04b".`

*Hand Sipho the spare card, 04b.*

Four signatures again. Same as before.

*Get four votes at the station, then execute.*

`Presenter: DEMO 8, execute after the timelock.`

Now, the thief. That's me, with the old card.

`Signing station: scan the old card 06.`

*The slip says "Not a member". Show it.*

★ Not a member. The card that was Sipho ten seconds ago is a piece of plastic. Every vote it
ever cast still counts, because votes are counted per member, not per card. But it will never
sign as Sipho again.

*Sipho scans 04b.*

And Sipho, with the new card, is Sipho.

✂️ *Optional beat:* And a small detail for the people who build these things: the new card
can't vote a second time on anything the old card already voted on. Same member, one vote. The
contract remembers members, not keys.

---

## 16 · 22:00 · ✂️ Kill the server

*This is the second cut.*

One more thing, because I promised the relayer can't be trusted and I should prove it doesn't
matter.

`Presenter: DEMO 9, "Stop the relayer".`

The backend just died. The dashboard still has the bank page, still has the chain page, still
has every event, because it reads them from the chain, not from my server.

*Wait for the restart line.*

And it's back, three seconds later, and it replayed the bank and the chain and sent nothing
twice, because it can't: the contract already has everything it would send.

You could delete my laptop and this stokvel would still know who paid.

---

## 17 · 23:00 · Honest limits and what's next

*Slower. This is the part that makes the rest believable.*

What this doesn't do, said plainly.

The relayer is trusted to report what the bank did. The contract can stop it lying twice, and
it can stop it paying the wrong person, but it can't see the bank's ledger. The members can.

Group accounts need KYC. Six people sharing an account with an API key is a demo, not a
product. The real version is a proper club account.

There's no tokenised rand here, on purpose. The day there is one that a bank stands behind,
the bank half of this gets simpler.

And these cards should be passkeys. A phone that signs, not a QR you can photograph.

*Credits.*

None of this started with me. Peter Smythe's dual-auth card tutorial taught me how the card
runtime behaves, including the two-second rule. His swipe-and-save tutorial is where the
round-up pattern comes from. The links are on the slide and in the repo. This community is why
this exists.

---

## 18 · 24:00 · Close

*The repo QR is up. The quilt is on the screen.*

So. Six strangers, a bank account, a contract, and a thief.

★ We didn't replace the trust. We wrote it down where nobody can erase it.

*Beat.*

The repo is on the screen. Clone it, run one command, break it, and tell me what you broke.
Thank you to my committee. *Name them.* Thank you.

*Stay up for questions.*

---

## If a demo fails

Say this, and move on: "That's the live path. The recorded one is behind it." Then press the
fallback toggle on the presenter panel and step the same demo from the script. The details are
in `FALLBACK.md`. Never apologise twice.
