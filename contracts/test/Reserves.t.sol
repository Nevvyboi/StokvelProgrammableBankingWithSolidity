// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {IStokvel} from "../src/IStokvel.sol";

/// @dev Proof of reserves: stale, short, replayed and forged attestations.
contract ReservesTest is Fixture {
    function test_postReserves_happyPath() public {
        contribute(0, 500, "a");
        uint64 at = uint64(block.timestamp);
        vm.expectEmit(true, true, true, true);
        emit IStokvel.ReservesPosted(500, at, 500);
        vm.prank(stranger); // the signature is what matters, not who submits it
        s.postReserves(500, at, signReserves(address(s), attestorPk, 500, at));
        assertEq(s.reservesCents(), 500);
        assertEq(s.reservesAt(), at);
    }

    function test_postReserves_revertsForged() public {
        uint256 fakePk = 0xF4CE;
        uint64 at = uint64(block.timestamp);
        vm.expectRevert(IStokvel.BadAttestation.selector);
        s.postReserves(1e9, at, signReserves(address(s), fakePk, 1e9, at));
    }

    function test_postReserves_revertsRelayerSigning() public {
        // the relayer key is not the attestor key, on purpose
        uint64 at = uint64(block.timestamp);
        vm.expectRevert(IStokvel.BadAttestation.selector);
        s.postReserves(1e9, at, signReserves(address(s), relayerPk, 1e9, at));
    }

    function test_postReserves_revertsTamperedAmount() public {
        uint64 at = uint64(block.timestamp);
        bytes memory sig = signReserves(address(s), attestorPk, 100, at);
        vm.expectRevert(IStokvel.BadAttestation.selector);
        s.postReserves(100_000, at, sig);
    }

    function test_postReserves_revertsGarbageSignature() public {
        vm.expectRevert(IStokvel.BadAttestation.selector);
        s.postReserves(1, uint64(block.timestamp), hex"00");
    }

    function test_postReserves_revertsFuture() public {
        uint64 at = uint64(block.timestamp + 1);
        vm.expectRevert(IStokvel.BadAttestation.selector);
        s.postReserves(1, at, signReserves(address(s), attestorPk, 1, at));
    }

    function test_postReserves_revertsReplay() public {
        uint64 at = uint64(block.timestamp);
        bytes memory sig = signReserves(address(s), attestorPk, 900, at);
        s.postReserves(900, at, sig);
        vm.warp(block.timestamp + 10);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.ReservesStale.selector, at, at + 1));
        s.postReserves(900, at, sig);
    }

    function test_postReserves_revertsOlderThanLatest() public {
        uint64 later = uint64(block.timestamp);
        attestAt(900, later);
        uint64 earlier = later - 60;
        vm.expectRevert(abi.encodeWithSelector(IStokvel.ReservesStale.selector, earlier, later + 1));
        s.postReserves(900, earlier, signReserves(address(s), attestorPk, 900, earlier));
    }

    function test_postReserves_wrongDomainIsRejected() public {
        // an attestation for a different Stokvel deployment must not carry over
        address other = deploy(address(0));
        uint64 at = uint64(block.timestamp);
        bytes memory sig = signReserves(other, attestorPk, 700, at);
        vm.expectRevert(IStokvel.BadAttestation.selector);
        s.postReserves(700, at, sig);
    }

    function test_theft_isCaughtAtClose() public {
        fullMonth(0);
        s.closeRound(); // month one is fine
        vm.prank(relayer);
        s.confirmPayout(0, beneficiaryId[0], ref("pay-0"));

        for (uint8 i; i < 6; ++i) {
            contribute(i, uint128(CONTRIBUTION), string(abi.encodePacked("m2-", NAMES[i])));
        }
        // treasurer moves R1,000 out; the next attestation reports the shortfall
        vm.warp(s.roundEndsAt());
        attest(CONTRIBUTION * 6 - 100_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                IStokvel.ReservesShort.selector, CONTRIBUTION * 6 - 100_000, CONTRIBUTION * 6
            )
        );
        s.closeRound();

        // money comes back, the club moves on
        attest(CONTRIBUTION * 6);
        s.closeRound();
    }

    function test_theft_afterAttestationNeedsFreshProof() public {
        // an honest attestation, then theft, then the treasurer stalls for an hour hoping the old proof holds
        fullMonth(0);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IStokvel.ReservesStale.selector, s.reservesAt(), uint64(block.timestamp - 1 hours)
            )
        );
        s.closeRound();
    }

    function testFuzz_shortByAnyAmountFails(uint256 shortBy) public {
        fullMonth(0);
        uint256 owed = s.pot();
        shortBy = bound(shortBy, 1, owed);
        attest(owed - shortBy);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.ReservesShort.selector, owed - shortBy, owed));
        s.closeRound();
    }

    function testFuzz_surplusIsFine(uint256 extra) public {
        fullMonth(0);
        extra = bound(extra, 0, 1e15);
        attest(s.pot() + extra);
        s.closeRound();
    }
}
