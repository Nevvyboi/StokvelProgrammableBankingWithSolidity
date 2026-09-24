// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IStokvel} from "../src/IStokvel.sol";

/// @dev Drives a Stokvel (V1 or V2) with random months: contributions, repeated webhooks,
///      honest and dishonest attestations, closes and confirms. It keeps its own ledger of what
///      the bank really did, so the invariants can compare the contract against the truth.
contract Handler is Test {
    IStokvel public s;
    address public relayer;
    uint256 public attestorPk;
    bytes32[] public beneficiaryIds;
    uint256 public memberCount;

    // the truth, as the bank sees it
    uint256 public bankBalance;
    uint256 public ghostTotalIn;
    uint256 public ghostSettledOut;
    uint256 public ghostContributions; // count of distinct bank credits recorded
    uint256 public ghostDuplicateAttempts;
    uint256 public ghostDuplicateAccepted;
    uint256 public ghostClosesWhileShort;
    uint256 public ghostCloses;
    bytes32[] public refs;
    mapping(bytes32 => uint256) public timesRecorded;

    uint256 internal nextTx;
    bytes32 private constant RESERVES_TYPEHASH = keccak256("Reserves(uint256 cents,uint64 at)");

    constructor(IStokvel s_, address relayer_, uint256 attestorPk_, bytes32[] memory beneficiaryIds_) {
        s = s_;
        relayer = relayer_;
        attestorPk = attestorPk_;
        beneficiaryIds = beneficiaryIds_;
        memberCount = s_.memberCount();
    }

    // ------------------------------------------------------------ actions

    /// @dev A member pays in and the bank credit is reported once.
    function contribute(uint8 memberSeed, uint128 cents) external {
        uint8 memberId = uint8(bound(memberSeed, 0, memberCount - 1));
        cents = uint128(bound(cents, 1, 1_000_000));
        bytes32 r = keccak256(abi.encode("tx", nextTx++));
        bankBalance += cents;
        vm.prank(relayer);
        try s.recordContribution(memberId, cents, r) {
            refs.push(r);
            memberOfRef[r] = memberId;
            centsOfRef[r] = cents;
            timesRecorded[r] += 1;
            ghostTotalIn += cents;
            ghostContributions += 1;
        } catch {}
    }

    /// @dev The webhook fires again for a credit that was already reported. The bank did not move.
    function duplicateWebhook(uint256 refSeed) external {
        if (refs.length == 0) return;
        bytes32 r = refs[bound(refSeed, 0, refs.length - 1)];
        (uint8 memberId, uint128 cents) = _decode(r);
        ghostDuplicateAttempts += 1;
        vm.prank(relayer);
        try s.recordContribution(memberId, cents, r) {
            timesRecorded[r] += 1;
            ghostDuplicateAccepted += 1;
        } catch {}
    }

    /// @dev The relayer tries a made up amount.
    function hugeContribution(uint8 memberSeed, uint128 cents) external {
        uint8 memberId = uint8(bound(memberSeed, 0, memberCount - 1));
        cents = uint128(bound(cents, 1_000_001, type(uint128).max));
        vm.prank(relayer);
        try s.recordContribution(memberId, cents, keccak256(abi.encode("huge", nextTx++))) {
            revert("cap did not hold");
        } catch {}
    }

    /// @dev The attestor reports the balance the bank really holds.
    function attestHonest() external {
        _attest(bankBalance);
    }

    /// @dev The treasurer takes money out of the account and the next attestation shows it.
    function steal(uint256 amount) external {
        if (bankBalance == 0) return;
        amount = bound(amount, 1, bankBalance);
        bankBalance -= amount;
        _attest(bankBalance);
    }

    /// @dev The stolen money is returned (the story on stage).
    function refund(uint256 amount) external {
        uint256 owed = s.pot() + s.unsettled();
        if (bankBalance >= owed) return;
        amount = bound(amount, 0, owed - bankBalance);
        bankBalance += amount;
        _attest(bankBalance);
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 45 days));
    }

    function closeRound() external {
        uint256 owed = s.pot() + s.unsettled();
        bool short = s.reservesCents() < owed;
        try s.closeRound() {
            ghostCloses += 1;
            if (short) ghostClosesWhileShort += 1;
        } catch {}
    }

    /// @dev The relayer pays the recipient out of the bank and confirms.
    function confirmPayout(uint256 roundSeed) external {
        uint256 r = s.round();
        if (r == 0) return;
        uint256 closed = bound(roundSeed, 0, r - 1);
        (uint8 memberId, bool settled, uint256 cents,) = _payout(closed);
        if (settled || cents > bankBalance) return;
        bytes32 payRef = keccak256(abi.encode("pay", closed, nextTx++));
        vm.prank(relayer);
        try s.confirmPayout(closed, beneficiaryIds[memberId], payRef) {
            bankBalance -= cents;
            ghostSettledOut += cents;
        } catch {}
    }

    /// @dev The relayer pays the wrong person and tries to confirm anyway.
    function confirmWrongBeneficiary(uint256 roundSeed, uint8 whoSeed) external {
        uint256 r = s.round();
        if (r == 0) return;
        uint256 closed = bound(roundSeed, 0, r - 1);
        (uint8 memberId,,,) = _payout(closed);
        uint8 who = uint8(bound(whoSeed, 0, memberCount - 1));
        if (who == memberId) who = uint8((who + 1) % memberCount);
        vm.prank(relayer);
        try s.confirmPayout(closed, beneficiaryIds[who], keccak256(abi.encode("wrong", closed, nextTx++))) {
            revert("wrong beneficiary accepted");
        } catch {}
    }

    // ------------------------------------------------------------ views for the invariants

    function refCount() external view returns (uint256) {
        return refs.length;
    }

    function sumPaid() external view returns (uint256 total) {
        for (uint256 i; i < memberCount; ++i) {
            (,, uint128 paid) = s.members(i);
            total += paid;
        }
    }

    // ------------------------------------------------------------ internals

    function _attest(uint256 cents) internal {
        uint64 at = uint64(block.timestamp);
        if (at <= s.reservesAt()) {
            vm.warp(uint256(s.reservesAt()) + 1);
            at = uint64(block.timestamp);
        }
        bytes32 structHash = keccak256(abi.encode(RESERVES_TYPEHASH, cents, at));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domain(), structHash));
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(attestorPk, digest);
        s.postReserves(cents, at, abi.encodePacked(rr, ss, v));
    }

    function _domain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Stokvel"),
                keccak256("1"),
                block.chainid,
                address(s)
            )
        );
    }

    // we can't read a contribution back from a ref, so remember what we sent
    mapping(bytes32 => uint8) internal memberOfRef;
    mapping(bytes32 => uint128) internal centsOfRef;

    function _decode(bytes32 r) internal view returns (uint8, uint128) {
        return (memberOfRef[r], centsOfRef[r]);
    }

    function _payout(uint256 closed) internal view returns (uint8, bool, uint256, bytes32) {
        (bool ok, bytes memory data) =
            address(s).staticcall(abi.encodeWithSignature("payouts(uint256)", closed));
        require(ok, "payouts view failed");
        return abi.decode(data, (uint8, bool, uint256, bytes32));
    }
}
