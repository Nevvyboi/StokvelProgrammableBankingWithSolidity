// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {IStokvel} from "../src/IStokvel.sol";

/// @dev Gasless card votes: quorum, timelock, nonce replay, rotated keys, the old key rejected.
contract GovernanceTest is Fixture {
    function proposeRaise() internal returns (uint256 id) {
        vm.prank(memberKey[0]);
        id = s.propose(IStokvel.Kind.SetContribution, 600_000, 0, address(0));
    }

    // ------------------------------------------------------------ propose

    function test_propose_byMember() public {
        vm.expectEmit(true, true, true, true);
        emit IStokvel.ProposalCreated(0, IStokvel.Kind.SetContribution, 600_000, 0, address(0), memberKey[0]);
        uint256 id = proposeRaise();
        assertEq(id, 0);
        assertEq(s.proposalCount(), 1);
    }

    function test_propose_byRelayer() public {
        vm.prank(relayer);
        s.propose(IStokvel.Kind.ReplaceRelayer, 0, 0, address(0x1234));
    }

    function test_propose_revertsForStranger() public {
        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotMemberOrRelayer.selector, stranger));
        vm.prank(stranger);
        s.propose(IStokvel.Kind.SetContribution, 600_000, 0, address(0));
    }

    function test_propose_validates() public {
        vm.startPrank(memberKey[0]);
        vm.expectRevert(IStokvel.BadProposal.selector);
        s.propose(IStokvel.Kind.SetContribution, 0, 0, address(0));
        vm.expectRevert(IStokvel.BadProposal.selector);
        s.propose(IStokvel.Kind.SetContribution, 1_000_001, 0, address(0));
        vm.expectRevert(abi.encodeWithSelector(IStokvel.UnknownMember.selector, uint8(9)));
        s.propose(IStokvel.Kind.RotateKey, 0, 9, address(0x1));
        vm.expectRevert(IStokvel.BadProposal.selector);
        s.propose(IStokvel.Kind.RotateKey, 0, 1, address(0));
        vm.expectRevert(abi.encodeWithSelector(IStokvel.KeyInUse.selector, memberKey[3]));
        s.propose(IStokvel.Kind.RotateKey, 0, 1, memberKey[3]);
        vm.expectRevert(IStokvel.BadProposal.selector);
        s.propose(IStokvel.Kind.ReplaceRelayer, 0, 0, address(0));
        vm.expectRevert(IStokvel.BadProposal.selector);
        s.propose(IStokvel.Kind.ReplaceAttestor, 0, 0, address(0));
        vm.stopPrank();
    }

    // ------------------------------------------------------------ voteBySig

    function test_vote_countsAndQueuesAtStrictMajority() public {
        uint256 id = proposeRaise();
        vote(id, 0);
        vote(id, 1);
        vote(id, 2); // 3 of 6 is not a strict majority
        (,, uint8 yes,,,, uint64 eta,) = s.proposals(id);
        assertEq(yes, 3);
        assertEq(eta, 0);

        vm.expectEmit(true, true, true, true);
        emit IStokvel.ProposalQueued(id, uint64(block.timestamp) + TIMELOCK);
        vote(id, 3); // 4 of 6 is
        (,, yes,,,, eta,) = s.proposals(id);
        assertEq(yes, 4);
        assertEq(eta, uint64(block.timestamp) + TIMELOCK);
    }

    function test_vote_isGasless() public {
        uint256 id = proposeRaise();
        bytes memory sig = signVote(address(s), memberPk[4], id, 0);
        vm.prank(stranger); // the relayer, or anyone, submits on the member's behalf
        s.voteBySig(id, 0, sig);
        assertTrue(s.hasVoted(id, 4));
        assertEq(s.nonces(memberKey[4]), 1);
    }

    function test_vote_revertsReplayedNonce() public {
        uint256 id = proposeRaise();
        bytes memory sig = signVote(address(s), memberPk[1], id, 0);
        s.voteBySig(id, 0, sig);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.BadNonce.selector, 1, 0));
        s.voteBySig(id, 0, sig);
    }

    function test_vote_revertsReplayOnAnotherProposal() public {
        uint256 a = proposeRaise();
        vm.prank(memberKey[0]);
        uint256 b = s.propose(IStokvel.Kind.SetContribution, 700_000, 0, address(0));
        bytes memory sigForA = signVote(address(s), memberPk[1], a, 0);
        // the proposal id is inside the signed struct, so a vote for A recovers to a stranger on B
        vm.expectPartialRevert(IStokvel.NotMember.selector);
        s.voteBySig(b, 0, sigForA);
    }

    function test_vote_revertsWrongDomain() public {
        address other = deploy(address(0));
        uint256 id = proposeRaise();
        bytes memory sig = signVote(other, memberPk[1], id, 0);
        // recovers to a different address, which is not a member here
        vm.expectRevert();
        s.voteBySig(id, 0, sig);
    }

    function test_vote_revertsAlreadyVoted() public {
        uint256 id = proposeRaise();
        vote(id, 2);
        (uint256 nonce, bytes memory sig) = voteSig(id, 2);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.AlreadyVoted.selector, id, uint8(2)));
        s.voteBySig(id, nonce, sig);
    }

    function test_vote_revertsStranger() public {
        uint256 id = proposeRaise();
        uint256 pk = 0xBAD;
        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotMember.selector, vm.addr(pk)));
        s.voteBySig(id, 0, signVote(address(s), pk, id, 0));
    }

    function test_vote_revertsUnknownProposal() public {
        vm.expectRevert(abi.encodeWithSelector(IStokvel.UnknownProposal.selector, 5));
        s.voteBySig(5, 0, signVote(address(s), memberPk[0], 5, 0));
    }

    function test_vote_revertsAfterVotingPeriod() public {
        uint256 id = proposeRaise();
        vm.warp(block.timestamp + 7 days + 1);
        (uint256 nonce, bytes memory sig) = voteSig(id, 0);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.ProposalExpired.selector, id));
        s.voteBySig(id, nonce, sig);
    }

    // ------------------------------------------------------------ execute

    function test_execute_setContribution() public {
        uint256 id = proposeRaise();
        for (uint256 i; i < 4; ++i) {
            vote(id, i);
        }
        vm.expectRevert(
            abi.encodeWithSelector(IStokvel.TimelockActive.selector, uint64(block.timestamp) + TIMELOCK)
        );
        s.execute(id);

        vm.warp(block.timestamp + TIMELOCK);
        vm.expectEmit(true, true, true, true);
        emit IStokvel.ContributionChanged(500_000, 600_000);
        vm.prank(stranger);
        s.execute(id);
        assertEq(s.contributionCents(), 600_000);

        vm.expectRevert(abi.encodeWithSelector(IStokvel.AlreadyExecuted.selector, id));
        s.execute(id);
    }

    function test_execute_revertsNotQueued() public {
        uint256 id = proposeRaise();
        vote(id, 0);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotQueued.selector, id));
        s.execute(id);
    }

    function test_execute_revertsAfterWindow() public {
        uint256 id = proposeRaise();
        for (uint256 i; i < 4; ++i) {
            vote(id, i);
        }
        vm.warp(block.timestamp + TIMELOCK + 7 days + 1);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.ProposalExpired.selector, id));
        s.execute(id);
    }

    function test_execute_replaceRelayerAndAttestor() public {
        vm.prank(memberKey[0]);
        uint256 a = s.propose(IStokvel.Kind.ReplaceRelayer, 0, 0, address(0xAAAA));
        vm.prank(memberKey[0]);
        uint256 b = s.propose(IStokvel.Kind.ReplaceAttestor, 0, 0, address(0xBBBB));
        for (uint256 i; i < 4; ++i) {
            vote(a, i);
            vote(b, i);
        }
        vm.warp(block.timestamp + TIMELOCK);
        s.execute(a);
        s.execute(b);
        assertEq(s.relayer(), address(0xAAAA));
        assertEq(s.attestor(), address(0xBBBB));
        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotRelayer.selector, relayer));
        contribute(0, 1, "old-relayer");
    }

    function test_votesAfterQueueStillCount() public {
        uint256 id = proposeRaise();
        for (uint256 i; i < 5; ++i) {
            vote(id, i);
        }
        (,, uint8 yes,,,, uint64 eta,) = s.proposals(id);
        assertEq(yes, 5);
        assertEq(eta, uint64(block.timestamp) + TIMELOCK); // eta set once, at the fourth vote
    }

    // ------------------------------------------------------------ social recovery

    function test_rotateKey_fullStory() public {
        // Sipho's card (member 05, memberId 5) is stolen. The thief holds the key.
        uint256 thiefPk = memberPk[5];
        uint256 spare04bPk = uint256(keccak256("spare 04b"));
        address spare04b = vm.addr(spare04bPk);

        vm.prank(memberKey[0]);
        uint256 recover = s.propose(IStokvel.Kind.RotateKey, 0, 5, spare04b);
        for (uint256 i; i < 4; ++i) {
            vote(recover, i);
        }
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectEmit(true, true, true, true);
        emit IStokvel.KeyRotated(5, memberKey[5], spare04b);
        s.execute(recover);

        assertEq(s.idOf(memberKey[5]), 0);
        assertEq(s.idOf(spare04b), 6);
        (address key,,) = s.members(5);
        assertEq(key, spare04b);

        // a new proposal: the thief tries to vote with the stolen card
        vm.prank(memberKey[0]);
        uint256 next = s.propose(IStokvel.Kind.SetContribution, 600_000, 0, address(0));
        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotMember.selector, memberKey[5]));
        s.voteBySig(next, 0, signVote(address(s), thiefPk, next, 0));

        // the spare card votes as Sipho
        s.voteBySig(next, 0, signVote(address(s), spare04bPk, next, 0));
        assertTrue(s.hasVoted(next, 5));
    }

    function test_rotateKey_rotatedKeyCannotVoteTwice() public {
        // Sipho votes on a proposal, gets a new key mid-vote, tries again with the new key
        uint256 id = proposeRaise();
        vote(id, 5);

        uint256 newPk = uint256(keccak256("new key"));
        vm.prank(memberKey[0]);
        uint256 recover = s.propose(IStokvel.Kind.RotateKey, 0, 5, vm.addr(newPk));
        for (uint256 i; i < 4; ++i) {
            vote(recover, i);
        }
        vm.warp(block.timestamp + TIMELOCK);
        s.execute(recover);

        vm.expectRevert(abi.encodeWithSelector(IStokvel.AlreadyVoted.selector, id, uint8(5)));
        s.voteBySig(id, 0, signVote(address(s), newPk, id, 0));
        (,, uint8 yes,,,,,) = s.proposals(id);
        assertEq(yes, 1);
    }

    function test_rotateKey_thiefCannotJoinOrProposeAfterwards() public {
        uint256 newPk = uint256(keccak256("new key"));
        vm.prank(memberKey[0]);
        uint256 recover = s.propose(IStokvel.Kind.RotateKey, 0, 5, vm.addr(newPk));
        for (uint256 i; i < 4; ++i) {
            vote(recover, i);
        }
        vm.warp(block.timestamp + TIMELOCK);
        s.execute(recover);

        vm.expectRevert(abi.encodeWithSelector(IStokvel.NotMemberOrRelayer.selector, memberKey[5]));
        vm.prank(memberKey[5]);
        s.propose(IStokvel.Kind.SetContribution, 600_000, 0, address(0));
    }

    function test_rotateKey_revertsIfKeyTakenBetweenProposeAndExecute() public {
        address shared = vm.addr(uint256(keccak256("shared")));
        vm.prank(memberKey[0]);
        uint256 a = s.propose(IStokvel.Kind.RotateKey, 0, 4, shared);
        vm.prank(memberKey[0]);
        uint256 b = s.propose(IStokvel.Kind.RotateKey, 0, 5, shared);
        for (uint256 i; i < 4; ++i) {
            vote(a, i);
            vote(b, i);
        }
        vm.warp(block.timestamp + TIMELOCK);
        s.execute(a);
        vm.expectRevert(abi.encodeWithSelector(IStokvel.KeyInUse.selector, shared));
        s.execute(b);
    }

    function testFuzz_quorumIsStrictMajority(uint8 votes) public {
        votes = uint8(bound(votes, 0, 6));
        uint256 id = proposeRaise();
        for (uint256 i; i < votes; ++i) {
            vote(id, i);
        }
        (,,,,,, uint64 eta,) = s.proposals(id);
        if (votes >= 4) assertGt(eta, 0);
        else assertEq(eta, 0);
    }
}
