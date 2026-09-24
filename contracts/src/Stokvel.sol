// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IStokvel} from "./IStokvel.sol";

/// @title Stokvel
/// @notice The treasurer, written down. Rules and records only: this contract never holds money.
contract Stokvel is IStokvel, EIP712 {
    struct Payout {
        uint8 memberId;
        bool settled;
        uint256 cents;
        bytes32 beneficiaryHash;
    }

    struct Proposal {
        Kind kind;
        uint8 memberId;
        uint8 yes;
        bool executed;
        address newAddr;
        uint64 createdAt;
        uint64 eta;
        uint256 value;
    }

    uint256 public constant MAX_CONTRIBUTION_CENTS = 1_000_000; // R10,000
    uint256 public constant RESERVES_MAX_AGE = 1 hours;
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant EXECUTION_WINDOW = 7 days;

    bytes32 private constant RESERVES_TYPEHASH = keccak256("Reserves(uint256 cents,uint64 at)");
    bytes32 private constant VOTE_TYPEHASH = keccak256("Vote(uint256 proposalId,uint256 nonce)");
    bytes32 private constant JOIN_TYPEHASH = keccak256("Join(string constitution)");

    Member[] public members;
    mapping(address => uint256) public idOf; // memberId + 1, so 0 means not a member
    mapping(bytes32 => bool) public seen;
    mapping(address => uint256) public nonces;
    mapping(uint8 => bool) public joined;

    address public relayer;
    address public attestor;
    bytes32 public immutable constitutionHash;
    uint64 public immutable roundLength;
    uint64 public immutable timelock;

    uint256 public contributionCents;
    uint256 public round;
    uint64 public roundEndsAt;
    uint256 public pot;
    uint256 public unsettled;
    uint256 public totalIn;
    uint256 public settledOut;

    uint256 public reservesCents;
    uint64 public reservesAt;

    mapping(uint256 => Payout) public payouts;
    mapping(uint256 => mapping(uint8 => uint256)) public paidInRound;

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;
    mapping(uint256 => mapping(uint8 => bool)) public hasVoted;

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer(msg.sender);
        _;
    }

    constructor(Config memory cfg) EIP712("Stokvel", "1") {
        uint256 n = cfg.keys.length;
        if (n < 2 || n > 64 || n != cfg.beneficiaryHashes.length) revert BadConfig();
        if (cfg.relayer == address(0) || cfg.attestor == address(0) || cfg.roundLength == 0) {
            revert BadConfig();
        }
        if (cfg.contributionCents == 0 || cfg.contributionCents > MAX_CONTRIBUTION_CENTS) revert BadConfig();
        for (uint256 i; i < n; ++i) {
            address key = cfg.keys[i];
            if (key == address(0) || idOf[key] != 0) revert BadConfig();
            members.push(Member({key: key, beneficiaryHash: cfg.beneficiaryHashes[i], paidCents: 0}));
            idOf[key] = i + 1;
        }
        relayer = cfg.relayer;
        attestor = cfg.attestor;
        contributionCents = cfg.contributionCents;
        roundEndsAt = cfg.firstRoundEndsAt;
        roundLength = cfg.roundLength;
        timelock = cfg.timelock;
        constitutionHash = cfg.constitutionHash;
        emit RoundOpened(0, 0, cfg.firstRoundEndsAt);
    }

    // ---------------------------------------------------------------- money in

    function recordContribution(uint8 memberId, uint128 cents, bytes32 investecRef) external onlyRelayer {
        if (seen[investecRef]) revert AlreadyRecorded(investecRef);
        if (memberId >= members.length) revert UnknownMember(memberId);
        if (cents == 0) revert ZeroAmount();
        if (cents > MAX_CONTRIBUTION_CENTS) revert AmountTooLarge(cents, MAX_CONTRIBUTION_CENTS);

        seen[investecRef] = true;
        members[memberId].paidCents += cents;
        paidInRound[round][memberId] += cents;
        pot += cents;
        totalIn += cents;
        emit ContributionRecorded(round, memberId, cents, investecRef);
    }

    // ---------------------------------------------------------------- proof of reserves

    function postReserves(uint256 cents, uint64 at, bytes calldata sig) external {
        if (at > block.timestamp) revert BadAttestation();
        if (at <= reservesAt) revert ReservesStale(at, reservesAt + 1);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RESERVES_TYPEHASH, cents, at)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || signer != attestor) revert BadAttestation();

        reservesCents = cents;
        reservesAt = at;
        emit ReservesPosted(cents, at, pot + unsettled);
    }

    // ---------------------------------------------------------------- money out

    function closeRound() external {
        uint256 owed = pot + unsettled;
        if (reservesAt == 0 || uint256(reservesAt) + RESERVES_MAX_AGE < block.timestamp) {
            uint256 notBefore = block.timestamp > RESERVES_MAX_AGE ? block.timestamp - RESERVES_MAX_AGE : 0;
            revert ReservesStale(reservesAt, uint64(notBefore));
        }
        if (reservesCents < owed) revert ReservesShort(reservesCents, owed);
        if (block.timestamp < roundEndsAt) revert RoundStillOpen(roundEndsAt);

        uint256 closing = round;
        uint8 recipient = uint8(closing % members.length);
        uint256 cents = pot;
        bytes32 beneficiaryHash = members[recipient].beneficiaryHash;

        payouts[closing] = Payout({
            memberId: recipient, settled: cents == 0, cents: cents, beneficiaryHash: beneficiaryHash
        });
        pot = 0;
        unsettled += cents;
        emit PayoutDue(closing, recipient, cents, beneficiaryHash);

        round = closing + 1;
        roundEndsAt = uint64(block.timestamp) + roundLength;
        emit RoundOpened(closing + 1, uint8((closing + 1) % members.length), roundEndsAt);
    }

    function confirmPayout(uint256 closedRound, bytes32 beneficiaryId, bytes32 investecRef)
        external
        onlyRelayer
    {
        if (seen[investecRef]) revert AlreadyRecorded(investecRef);
        Payout storage p = payouts[closedRound];
        if (closedRound >= round || p.settled) revert UnknownPayout(closedRound);
        if (keccak256(abi.encode(beneficiaryId)) != p.beneficiaryHash) {
            revert WrongBeneficiary(closedRound, p.memberId);
        }

        seen[investecRef] = true;
        p.settled = true;
        unsettled -= p.cents;
        settledOut += p.cents;
        emit PayoutSettled(closedRound, p.memberId, p.cents, investecRef);
    }

    // ---------------------------------------------------------------- the committee

    function joinBySig(bytes calldata sig) external {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(JOIN_TYPEHASH, constitutionHash)));
        address signer = _recover(digest, sig);
        uint8 memberId = _memberIdOf(signer);
        if (joined[memberId]) revert AlreadyJoined(memberId);
        joined[memberId] = true;
        emit MemberJoined(memberId, signer);
    }

    function propose(Kind kind, uint256 value, uint8 memberId, address newAddr)
        external
        returns (uint256 id)
    {
        if (idOf[msg.sender] == 0 && msg.sender != relayer) {
            revert NotMemberOrRelayer(msg.sender);
        }
        if (kind == Kind.SetContribution) {
            if (value == 0 || value > MAX_CONTRIBUTION_CENTS) revert BadProposal();
        } else if (kind == Kind.RotateKey) {
            if (memberId >= members.length) revert UnknownMember(memberId);
            if (newAddr == address(0)) revert BadProposal();
            if (idOf[newAddr] != 0) revert KeyInUse(newAddr);
        } else if (newAddr == address(0)) {
            revert BadProposal();
        }

        id = proposalCount++;
        proposals[id] = Proposal({
            kind: kind,
            memberId: memberId,
            yes: 0,
            executed: false,
            newAddr: newAddr,
            createdAt: uint64(block.timestamp),
            eta: 0,
            value: value
        });
        emit ProposalCreated(id, kind, value, memberId, newAddr, msg.sender);
    }

    function voteBySig(uint256 proposalId, uint256 nonce, bytes calldata sig) external {
        Proposal storage p = _proposal(proposalId);
        if (p.executed) revert AlreadyExecuted(proposalId);
        if (block.timestamp > p.createdAt + VOTING_PERIOD) revert ProposalExpired(proposalId);

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(VOTE_TYPEHASH, proposalId, nonce)));
        address signer = _recover(digest, sig);
        uint8 memberId = _memberIdOf(signer);
        if (nonce != nonces[signer]) revert BadNonce(nonces[signer], nonce);
        // votes are counted per member, not per key, so a rotated key can't vote a second time
        if (hasVoted[proposalId][memberId]) revert AlreadyVoted(proposalId, memberId);

        nonces[signer] = nonce + 1;
        hasVoted[proposalId][memberId] = true;
        p.yes += 1;
        emit Voted(proposalId, memberId, signer, p.yes);

        if (p.eta == 0 && uint256(p.yes) * 2 > members.length) {
            p.eta = uint64(block.timestamp) + timelock;
            emit ProposalQueued(proposalId, p.eta);
        }
    }

    function execute(uint256 proposalId) external {
        Proposal storage p = _proposal(proposalId);
        if (p.executed) revert AlreadyExecuted(proposalId);
        if (p.eta == 0) revert NotQueued(proposalId);
        if (block.timestamp < p.eta) revert TimelockActive(p.eta);
        if (block.timestamp > p.eta + EXECUTION_WINDOW) revert ProposalExpired(proposalId);
        p.executed = true;

        if (p.kind == Kind.SetContribution) {
            emit ContributionChanged(contributionCents, p.value);
            contributionCents = p.value;
        } else if (p.kind == Kind.RotateKey) {
            if (idOf[p.newAddr] != 0) revert KeyInUse(p.newAddr);
            address oldKey = members[p.memberId].key;
            delete idOf[oldKey];
            idOf[p.newAddr] = uint256(p.memberId) + 1;
            members[p.memberId].key = p.newAddr;
            emit KeyRotated(p.memberId, oldKey, p.newAddr);
        } else if (p.kind == Kind.ReplaceRelayer) {
            emit RelayerReplaced(relayer, p.newAddr);
            relayer = p.newAddr;
        } else {
            emit AttestorReplaced(attestor, p.newAddr);
            attestor = p.newAddr;
        }
        emit ProposalExecuted(proposalId);
    }

    // ---------------------------------------------------------------- views

    function memberCount() external view returns (uint256) {
        return members.length;
    }

    function recipientOf(uint256 r) external view returns (uint8) {
        return uint8(r % members.length);
    }

    /// @notice Everything the club is owed right now, and what the bank last said it holds.
    function health() external view returns (uint256 held, uint256 owed, uint64 at, bool fresh) {
        held = reservesCents;
        owed = pot + unsettled;
        at = reservesAt;
        fresh = reservesAt != 0 && uint256(reservesAt) + RESERVES_MAX_AGE >= block.timestamp;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------- internals

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address signer) {
        ECDSA.RecoverError err;
        (signer, err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError) revert BadSignature();
    }

    function _memberIdOf(address signer) internal view returns (uint8) {
        uint256 idPlusOne = idOf[signer];
        if (idPlusOne == 0) revert NotMember(signer);
        return uint8(idPlusOne - 1);
    }

    function _proposal(uint256 proposalId) internal view returns (Proposal storage p) {
        if (proposalId >= proposalCount) revert UnknownProposal(proposalId);
        p = proposals[proposalId];
    }
}
