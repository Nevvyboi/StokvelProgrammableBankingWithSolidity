// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Fixture} from "./Fixture.sol";
import {Handler} from "./Handler.sol";
import {IStokvel} from "../src/IStokvel.sol";
import {StokvelV1Vulnerable} from "../src/StokvelV1Vulnerable.sol";

/// @dev The four rules that must survive 10,000 random months. Runs against V2 by default.
abstract contract InvariantBase is StdInvariant, Fixture {
    Handler internal h;

    function _target(IStokvel target) internal {
        bytes32[] memory ids = new bytes32[](6);
        for (uint256 i; i < 6; ++i) {
            ids[i] = beneficiaryId[i];
        }
        h = new Handler(target, relayer, attestorPk, ids);
        targetContract(address(h));
    }

    /// @notice sum(paidCents) == totalIn
    function invariant_memberTotalsMatchTotalIn() public view {
        assertEq(h.sumPaid(), h.s().totalIn(), "sum(paidCents) != totalIn");
    }

    /// @notice totalIn - settledOut == pot + unsettled
    function invariant_moneyIsConserved() public view {
        IStokvel c = h.s();
        assertEq(
            c.totalIn() - c.settledOut(), c.pot() + c.unsettled(), "totalIn - settledOut != pot + unsettled"
        );
    }

    /// @notice no Investec ref is ever used twice
    function invariant_noRefRecordedTwice() public view {
        uint256 n = h.refCount();
        for (uint256 i; i < n; ++i) {
            assertEq(h.timesRecorded(h.refs(i)), 1, "an Investec ref was recorded twice");
        }
        assertEq(h.ghostDuplicateAccepted(), 0, "a duplicate webhook was accepted");
    }

    /// @notice closeRound never succeeds when reserves < pot + unsettled
    function invariant_neverClosesWhileShort() public view {
        assertEq(h.ghostClosesWhileShort(), 0, "closeRound succeeded while reserves were short");
    }

    /// @notice the contract's idea of the total is the bank's idea of the total
    function invariant_totalInMatchesTheBank() public view {
        assertEq(h.s().totalIn(), h.ghostTotalIn(), "totalIn != what the bank actually received");
    }
}

contract InvariantV2Test is InvariantBase {
    function setUp() public override {
        super.setUp();
        _target(s);
    }
}

/// @dev Meant to fail. Run with: FOUNDRY_PROFILE=v1 forge test
contract InvariantV1Test is InvariantBase {
    function setUp() public override {
        super.setUp();
        _target(new StokvelV1Vulnerable(config()));
    }
}
