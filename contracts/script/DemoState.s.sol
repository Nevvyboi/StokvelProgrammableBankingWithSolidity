// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IStokvel} from "../src/IStokvel.sol";
import {Stokvel} from "../src/Stokvel.sol";

/// @notice Seeds a realistic mid-month state for rehearsals, one step per function so the launcher can
///         move Anvil's clock between steps (a broadcast script can't warp the chain it talks to).
///
///   forge script script/DemoState.s.sol --sig "join()"       --rpc-url anvil --broadcast
///   forge script script/DemoState.s.sol --sig "month(uint256)" 0 --rpc-url anvil --broadcast
///   cast rpc evm_increaseTime 2592000 && cast rpc evm_mine
///   forge script script/DemoState.s.sol --sig "closeAndSettle()" --rpc-url anvil --broadcast
///   ...
///   forge script script/DemoState.s.sol --sig "midMonth()"   --rpc-url anvil --broadcast
///
/// scripts/demo.sh runs the whole sequence. Each step also appends the bank side of what it did to
/// deployments/demo-ledger.json, which the mock Investec server loads, so bank and chain agree.
///
/// Keys: the relayer and attestor are Anvil accounts 1 and 2 unless RELAYER_PK / ATTESTOR_PK are set.
/// Members sign with Anvil accounts 3 to 8, or with the keys in MEMBERS_KEYS_FILE (cards/out/members.json).
contract DemoState is Script {
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    string[6] internal NAMES = ["Lerato", "Thabo", "Aisha", "Johan", "Priya", "Sipho"];

    bytes32 private constant RESERVES_TYPEHASH = keccak256("Reserves(uint256 cents,uint64 at)");
    bytes32 private constant JOIN_TYPEHASH = keccak256("Join(string constitution)");

    Stokvel internal s;
    uint256 internal relayerPk;
    uint256 internal attestorPk;
    uint256 internal contribution;

    function setUp() public {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        s = Stokvel(vm.parseJsonAddress(vm.readFile(path), ".stokvel"));
        relayerPk = vm.envOr("RELAYER_PK", vm.deriveKey(ANVIL_MNEMONIC, 1));
        attestorPk = vm.envOr("ATTESTOR_PK", vm.deriveKey(ANVIL_MNEMONIC, 2));
        contribution = s.contributionCents();
    }

    /// @notice Every member signs the constitution. Gasless for them: the relayer carries the signatures.
    function join() external {
        bytes32 structHash = keccak256(abi.encode(JOIN_TYPEHASH, s.constitutionHash()));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", s.domainSeparator(), structHash));
        vm.startBroadcast(relayerPk);
        for (uint256 i; i < 6; ++i) {
            if (s.joined(uint8(i))) continue;
            (uint8 v, bytes32 r, bytes32 sv) = vm.sign(memberPk(i), digest);
            s.joinBySig(abi.encodePacked(r, sv, v));
        }
        vm.stopBroadcast();
        console2.log("all six members have signed the constitution");
    }

    /// @notice Every member pays the full contribution for the current round and the balance is attested.
    function month(uint256 label) external {
        vm.startBroadcast(relayerPk);
        for (uint8 i; i < 6; ++i) {
            string memory txId = string.concat("demo-", vm.toString(label), "-", NAMES[i]);
            bytes32 r = keccak256(bytes(txId));
            if (s.seen(r)) continue;
            s.recordContribution(i, uint128(contribution), r);
            ledger("CREDIT", txId, contribution, string.concat("STK-0", vm.toString(i + 1)));
        }
        vm.stopBroadcast();
        attest();
        console2.log("month seeded, pot:", s.pot());
    }

    /// @notice Attest the honest balance, close the round, pay the recipient, confirm.
    ///         Run after the launcher has moved the clock past roundEndsAt.
    function closeAndSettle() external {
        attest();
        uint256 closing = s.round();
        uint8 who = s.recipientOf(closing);
        vm.startBroadcast(relayerPk);
        s.closeRound();
        (,, uint256 cents,) = s.payouts(closing);
        string memory payId = string.concat("demo-payout-", vm.toString(closing));
        s.confirmPayout(closing, beneficiaryId(who), keccak256(bytes(payId)));
        vm.stopBroadcast();
        ledger("DEBIT", payId, cents, string.concat("Stokvel payout to ", NAMES[who]));
        console2.log("round closed and settled, paid to member", who, "cents", cents);
    }

    /// @notice Four of six have paid this month. Priya and Sipho are still to come.
    function midMonth() external {
        vm.startBroadcast(relayerPk);
        for (uint8 i; i < 4; ++i) {
            string memory txId = string.concat("demo-current-", NAMES[i]);
            bytes32 r = keccak256(bytes(txId));
            if (s.seen(r)) continue;
            s.recordContribution(i, uint128(contribution), r);
            ledger("CREDIT", txId, contribution, string.concat("STK-0", vm.toString(i + 1)));
        }
        vm.stopBroadcast();
        attest();
        console2.log("mid month: 4 of 6 paid, pot:", s.pot(), "round:", s.round());
    }

    // ------------------------------------------------------------ helpers

    function attest() internal {
        uint256 held = s.pot() + s.unsettled();
        uint64 at = uint64(block.timestamp);
        if (at <= s.reservesAt()) return;
        bytes32 structHash = keccak256(abi.encode(RESERVES_TYPEHASH, held, at));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", s.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(attestorPk, digest);
        vm.broadcast(relayerPk);
        s.postReserves(held, at, abi.encodePacked(r, sv, v));
    }

    function memberPk(uint256 i) internal returns (uint256) {
        string memory file = vm.envOr("MEMBERS_KEYS_FILE", string(""));
        if (bytes(file).length == 0) return vm.deriveKey(ANVIL_MNEMONIC, uint32(3 + i));
        // keys are stored as 0x hex strings; JSON numbers can't hold 256 bits
        bytes32[] memory pks = vm.parseJsonBytes32Array(vm.readFile(file), ".privateKeys");
        return uint256(pks[i]);
    }

    function beneficiaryId(uint8 i) internal returns (bytes32) {
        string memory file = vm.envOr("MEMBERS_FILE", string(""));
        if (bytes(file).length == 0) return keccak256(abi.encodePacked("beneficiary:", NAMES[i]));
        return vm.parseJsonBytes32Array(vm.readFile(file), ".beneficiaryIds")[i];
    }

    /// @dev Append one bank-side line so the mock Investec server can replay the same history.
    function ledger(string memory kind, string memory txId, uint256 cents, string memory description)
        internal
    {
        string memory line = string.concat(
            '{"type":"',
            kind,
            '","id":"',
            txId,
            '","cents":',
            vm.toString(cents),
            ',"description":"',
            description,
            '","at":',
            vm.toString(block.timestamp),
            "}"
        );
        vm.writeLine("deployments/demo-ledger.jsonl", line);
    }
}
