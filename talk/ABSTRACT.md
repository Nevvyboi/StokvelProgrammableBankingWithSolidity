# The Treasurer Is a Smart Contract

### Rebuilding the stokvel with Solidity and Investec Programmable Banking

**Speaker:** Nevin Tom, data engineer and MSc student who builds on Investec Programmable Banking.
**Event:** Investec developer community, final Q4 2026 event. 25 minutes plus 5 minutes of Q&A.

## Short abstract

Over 11 million South Africans save through stokvels, and they all depend on one person: the treasurer. In this live-demo talk, six volunteers form a stokvel on stage. Real sandbox money moves through Investec's API, and a Solidity smart contract enforces the rules. We'll try to steal from it, double-count it and hijack it live, and watch the code refuse every time.

## Long abstract

A stokvel runs on trust: who paid, whose turn it is, and whether the money is actually still there. Today that trust lives in WhatsApp groups and one person's banking app. This session combines Investec Programmable Banking with a Solidity smart contract so the rules enforce themselves. Investec holds the rand; the blockchain holds the rulebook. On stage: a stokvel committee with physical member cards, card round-ups flowing on-chain, automatic month-end payouts through the Investec transfers API, a live proof-of-reserves check that catches a dishonest treasurer, a fuzzer finding a real bug in seconds, and social recovery when a member's card is "stolen". There are no wallets, no crypto to buy and no personal data, and the audience can verify every step on their own phones.

## Three takeaways

1. **The hybrid pattern:** money stays in the bank, rules live on-chain, and the relayer is a messenger only.
2. **Security as code:** idempotency, proof of reserves, invariants and timelocks, each shown breaking and then holding.
3. **Next-gen UX:** gasless signatures, human-readable approvals, and social recovery instead of "lose your key, lose everything".

## Framing

Investec has no stokvel product, while FNB, Standard Bank and Nedbank do. Investec doesn't sell a
stokvel account. With Programmable Banking, it doesn't need to. The target use case is investment
stokvels run by professionals, contributing R2,000 to R10,000 a month.

## Numbers on the slide

More than 11 million stokvel members, about 810,000 stokvels, roughly R50bn saved a year.
Source: NASASA via EWN, 14 August 2025,
https://www.ewn.co.za/2025/08/14/more-than-11-million-south-africans-are-members-of-stokvels-nasasa

## Credits on the slide

- Peter Smythe's dual-auth card tutorial: https://github.com/petersmythe/invapi-dual-auth
- Peter Smythe's round-up savings tutorial: https://github.com/petersmythe/investec-swipe-n-save
