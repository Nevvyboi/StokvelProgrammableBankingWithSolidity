// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {IStokvel} from "../src/IStokvel.sol";
import {Stokvel} from "../src/Stokvel.sol";

contract StokvelTest is Fixture {
    // ------------------------------------------------------------ constructor

    function test_constructor_setsMembersAndRoles() public view {
        assertEq(s.memberCount(), 6);
        for (uint256 i; i < 6; ++i) {
            (address key, bytes32 bh, uint128 paid) = s.members(i);
            assertEq(key, memberKey[i]);
            assertEq(bh, keccak256(abi.encode(beneficiaryId[i])));
            assertEq(paid, 0);
            assertEq(s.idOf(memberKey[i]), i + 1);
        }
        assertEq(s.idOf(stranger), 0);
        assertEq(s.relayer(), relayer);
        assertEq(s.attestor(), attestor);
        assertEq(s.contributionCents(), CONTRIBUTION);
        assertEq(s.round(), 0);
        assertEq(s.roundEndsAt(), start + ROUND_LENGTH);
        assertEq(s.timelock(), TIMELOCK);
    }

    function test_constructor_rejectsBadConfig() public {
        IStokvel.Config memory cfg = config();
        cfg.keys[1] = cfg.keys[0];
        vm.expectRevert(IStokvel.BadConfig.selector);
        new Stokvel(cfg);

        cfg = config();
        cfg.relayer = address(0);
        vm.expectRevert(IStokvel.BadConfig.selector);
        new Stokvel(cfg);

        cfg = config();
        cfg.contributionCents = 1_000_001;
        vm.expectRevert(IStokvel.BadConfig.selector);
        new Stokvel(cfg);

        cfg = config();
        cfg.beneficiaryHashes = new bytes32[](5);
        vm.expectRevert(IStokvel.BadConfig.selector);
        new Stokvel(cfg);
    }

    // ------------------------------------------------------------ recordContribution

    function test_recordContribution_happyPath() public {
        vm.expectEmit(true, true, true, true);
        emit IStokvel.ContributionRecorded(0, 2, 300, ref("tx-1"));
        contribute(2, 300, "tx-1");

        (,, uint128 paid) = s.members(2);
        assertEq(paid, 300);
        assertEq(s.pot(), 300);
        assertEq(s.totalIn(), 300);
        assertEq(s.paidInRound(0, 2), 300);
        assertTrue(s.seen(ref("tx-1")));
    }

    function test_recordContribution_revertsForStranger() public {
        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotRelayer.selector, stranger));
        vm.prank(stranger);
        s.recordContribution(0, 100, ref("x"));
    }

    function test_recordContribution_revertsAlreadyRecorded() public {
        contribute(0, 100, "same-webhook");
        vm.expectRevert(abi.encodeWithSelector(IStokvel.AlreadyRecorded.selector, ref("same-webhook")));
        contribute(0, 100, "same-webhook");
        assertEq(s.pot(), 100);
    }

    function test_recordContribution_revertsUnknownMember() public {
        vm.expectRevert(abi.encodeWithSelector(IStokvel.UnknownMember.selector, uint8(6)));
        contribute(6, 100, "x");
        vm.expectRevert(abi.encodeWithSelector(IStokvel.UnknownMember.selector, uint8(255)));
        contribute(255, 100, "y");
    }

    function test_recordContribution_revertsAmountTooLarge() public {
        vm.expectRevert(abi.encodeWithSelector(IStokvel.AmountTooLarge.selector, 1_000_001, 1_000_000));
        contribute(0, 1_000_001, "big");
        contribute(0, 1_000_000, "max-is-fine");
    }

    function test_recordContribution_revertsZero() public {
        vm.expectRevert(IStokvel.ZeroAmount.selector);
        contribute(0, 0, "zero");
    }

    function testFuzz_recordContribution_sumsPerMember(uint128 a, uint128 b) public {
        a = uint128(bound(a, 1, 1_000_000));
        b = uint128(bound(b, 1, 1_000_000));
        contribute(4, a, "a");
        contribute(4, b, "b");
        (,, uint128 paid) = s.members(4);
        assertEq(paid, uint128(uint256(a) + b));
        assertEq(s.pot(), uint256(a) + b);
    }

    // ------------------------------------------------------------ closeRound

    function test_closeRound_recipientIsRoundModSix() public {
        for (uint256 m; m < 8; ++m) {
            fullMonth(m);
            uint8 expected = uint8(m % 6);
            vm.expectEmit(true, true, true, true);
            emit IStokvel.PayoutDue(
                m, expected, CONTRIBUTION * 6, keccak256(abi.encode(beneficiaryId[expected]))
            );
            s.closeRound();
            assertEq(s.round(), m + 1);
            assertEq(s.recipientOf(s.round()), uint8((m + 1) % 6));
            (uint8 who, bool settled, uint256 cents,) = s.payouts(m);
            assertEq(who, expected);
            assertFalse(settled);
            assertEq(cents, CONTRIBUTION * 6);
            // settle so the next month's attestation only needs to cover the new pot
            vm.prank(relayer);
            s.confirmPayout(m, beneficiaryId[expected], ref(string(abi.encodePacked("pay-", vm.toString(m)))));
        }
    }

    function test_closeRound_anyoneCanCall() public {
        fullMonth(0);
        vm.prank(stranger);
        s.closeRound();
        assertEq(s.round(), 1);
    }

    function test_closeRound_movesPotToUnsettled() public {
        fullMonth(0);
        uint256 potBefore = s.pot();
        s.closeRound();
        assertEq(s.pot(), 0);
        assertEq(s.unsettled(), potBefore);
        assertEq(s.roundEndsAt(), uint64(block.timestamp) + ROUND_LENGTH);
    }

    function test_closeRound_revertsRoundStillOpen() public {
        contribute(0, 100, "a");
        attest(100);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.RoundStillOpen.selector, start + ROUND_LENGTH));
        s.closeRound();
    }

    function test_closeRound_revertsReservesStale_neverPosted() public {
        vm.warp(start + ROUND_LENGTH);
        vm.expectRevert(
            abi.encodeWithSelector(
                IStokvel.ReservesStale.selector, uint64(0), uint64(block.timestamp - 1 hours)
            )
        );
        s.closeRound();
    }

    function test_closeRound_revertsReservesStale_olderThanAnHour() public {
        fullMonth(0);
        uint64 postedAt = s.reservesAt();
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IStokvel.ReservesStale.selector, postedAt, uint64(block.timestamp - 1 hours)
            )
        );
        s.closeRound();
    }

    function test_closeRound_acceptsReservesExactlyOneHourOld() public {
        fullMonth(0);
        vm.warp(s.reservesAt() + 1 hours);
        s.closeRound();
    }

    function test_closeRound_revertsReservesShort() public {
        fullMonth(0);
        // the treasurer took R1,000 out after the attestation
        attest(s.pot() - 100_000);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.ReservesShort.selector, s.pot() - 100_000, s.pot()));
        s.closeRound();
    }

    function test_closeRound_countsUnsettledPayoutsAsOwed() public {
        fullMonth(0);
        s.closeRound();
        // month two: bank still holds month one's unpaid pot plus the new contributions
        for (uint8 i; i < 6; ++i) {
            contribute(i, uint128(CONTRIBUTION), string(abi.encodePacked("m2-", NAMES[i])));
        }
        vm.warp(s.roundEndsAt());
        attest(CONTRIBUTION * 6); // only covers one pot, not two
        vm.expectRevert(
            abi.encodeWithSelector(IStokvel.ReservesShort.selector, CONTRIBUTION * 6, CONTRIBUTION * 12)
        );
        s.closeRound();
        attest(CONTRIBUTION * 12);
        s.closeRound();
    }

    function test_closeRound_emptyPotIsSettledImmediately() public {
        vm.warp(start + ROUND_LENGTH);
        attest(0);
        s.closeRound();
        (, bool settled, uint256 cents,) = s.payouts(0);
        assertTrue(settled);
        assertEq(cents, 0);
        assertEq(s.unsettled(), 0);
    }

    // ------------------------------------------------------------ confirmPayout

    function test_confirmPayout_happyPath() public {
        fullMonth(0);
        s.closeRound();
        vm.expectEmit(true, true, true, true);
        emit IStokvel.PayoutSettled(0, 0, CONTRIBUTION * 6, ref("pay-0"));
        vm.prank(relayer);
        s.confirmPayout(0, beneficiaryId[0], ref("pay-0"));
        assertEq(s.unsettled(), 0);
        assertEq(s.settledOut(), CONTRIBUTION * 6);
        (, bool settled,,) = s.payouts(0);
        assertTrue(settled);
    }

    function test_confirmPayout_revertsForStranger() public {
        fullMonth(0);
        s.closeRound();
        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotRelayer.selector, stranger));
        vm.prank(stranger);
        s.confirmPayout(0, beneficiaryId[0], ref("pay-0"));
    }

    function test_confirmPayout_revertsWrongBeneficiary() public {
        fullMonth(0);
        s.closeRound();
        // the relayer paid Thabo instead of Lerato and tries to confirm anyway
        vm.expectRevert(abi.encodeWithSelector(IStokvel.WrongBeneficiary.selector, 0, uint8(0)));
        vm.prank(relayer);
        s.confirmPayout(0, beneficiaryId[1], ref("pay-0"));
        assertEq(s.unsettled(), CONTRIBUTION * 6);
    }

    function test_confirmPayout_revertsUnknownPayout() public {
        vm.expectRevert(abi.encodeWithSelector(IStokvel.UnknownPayout.selector, 0));
        vm.prank(relayer);
        s.confirmPayout(0, beneficiaryId[0], ref("pay-0"));

        fullMonth(0);
        s.closeRound();
        vm.expectRevert(abi.encodeWithSelector(IStokvel.UnknownPayout.selector, 1));
        vm.prank(relayer);
        s.confirmPayout(1, beneficiaryId[1], ref("pay-1"));
    }

    function test_confirmPayout_revertsWhenSettledTwice() public {
        fullMonth(0);
        s.closeRound();
        vm.startPrank(relayer);
        s.confirmPayout(0, beneficiaryId[0], ref("pay-0"));
        vm.expectRevert(abi.encodeWithSelector(IStokvel.UnknownPayout.selector, 0));
        s.confirmPayout(0, beneficiaryId[0], ref("pay-0-again"));
        vm.stopPrank();
    }

    function test_confirmPayout_revertsAlreadyRecordedRef() public {
        contribute(0, 100, "shared-ref");
        fullMonth(0);
        s.closeRound();
        vm.expectRevert(abi.encodeWithSelector(IStokvel.AlreadyRecorded.selector, ref("shared-ref")));
        vm.prank(relayer);
        s.confirmPayout(0, beneficiaryId[0], ref("shared-ref"));
    }

    // ------------------------------------------------------------ joinBySig

    function test_joinBySig_happyPath() public {
        vm.expectEmit(true, true, true, true);
        emit IStokvel.MemberJoined(2, memberKey[2]);
        vm.prank(stranger); // gasless: anyone can carry the signature
        s.joinBySig(signJoin(address(s), memberPk[2]));
        assertTrue(s.joined(2));
    }

    function test_joinBySig_revertsAlreadyJoined() public {
        s.joinBySig(signJoin(address(s), memberPk[2]));
        vm.expectRevert(abi.encodeWithSelector(IStokvel.AlreadyJoined.selector, uint8(2)));
        s.joinBySig(signJoin(address(s), memberPk[2]));
    }

    function test_joinBySig_revertsNotMember() public {
        uint256 thiefPk = 0xBAD;
        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotMember.selector, vm.addr(thiefPk)));
        s.joinBySig(signJoin(address(s), thiefPk));
    }

    function test_joinBySig_revertsBadSignature() public {
        vm.expectRevert(IStokvel.BadSignature.selector);
        s.joinBySig(hex"deadbeef");
    }

    // ------------------------------------------------------------ views

    function test_health() public {
        (uint256 held, uint256 owed, uint64 at, bool fresh) = s.health();
        assertEq(held, 0);
        assertEq(owed, 0);
        assertEq(at, 0);
        assertFalse(fresh);
        contribute(0, 100, "a");
        attest(100);
        (held, owed, at, fresh) = s.health();
        assertEq(held, 100);
        assertEq(owed, 100);
        assertEq(at, uint64(block.timestamp));
        assertTrue(fresh);
        vm.warp(block.timestamp + 1 hours + 1);
        (,,, fresh) = s.health();
        assertFalse(fresh);
    }

    function test_nothingToSteal() public view {
        assertEq(address(s).balance, 0);
    }

    function test_noFunctionAcceptsEther() public {
        (bool ok,) = address(s).call{value: 1 ether}("");
        assertFalse(ok);
    }
}
