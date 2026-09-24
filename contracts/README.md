# contracts

Foundry project. Solidity 0.8.24, OpenZeppelin 5.7 (EIP712, ECDSA).

| File | What |
|---|---|
| `src/Stokvel.sol` | The rulebook. Records, rules, votes. Never holds funds |
| `src/StokvelV1Vulnerable.sol` | Same contract minus one line, for DEMO 5. Never deploy it for real |
| `src/IStokvel.sol` | Interface, events and errors shared by both |
| `test/Stokvel.t.sol` | Every function, every custom error |
| `test/Reserves.t.sol` | Stale, short, replayed and forged attestations |
| `test/Governance.t.sol` | Quorum, timelock, nonce replay, rotated keys, the old key rejected |
| `test/Invariant.t.sol` + `Handler.sol` | 10,000 random months. Passes on V2, fails on V1 |
| `test/V1Exploit.t.sol` | The fuzzer's finding, written out by hand |
| `script/Deploy.s.sol` | Deploys V2 and V1, writes `deployments/<chainId>.json` |
| `script/DemoState.s.sol` | Seeds two settled months and a mid-month round for rehearsals |
| `CONSTITUTION.md` | The text every member signs on stage. Its hash is in the contract |

```bash
forge test                     # V2 suites, all green
FOUNDRY_PROFILE=v1 forge test  # V1 invariants, meant to fail
../scripts/fuzz.sh             # the same, as a demo
```

The one line diff between V1 and V2:

```bash
diff src/Stokvel.sol src/StokvelV1Vulnerable.sol
```

Deployment and Base Sepolia notes are in [`docs/DEPLOY.md`](../docs/DEPLOY.md). The threat model and
Slither results are in [`docs/SECURITY.md`](../docs/SECURITY.md).
