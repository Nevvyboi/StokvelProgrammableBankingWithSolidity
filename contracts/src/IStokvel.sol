// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IStokvel
/// @notice The rulebook of a rotating savings club. The money stays in an Investec account;
///         this contract only records who paid, whose turn it is, and whether the bank
///         still holds what the club is owed.
interface IStokvel {
    enum Kind {
        SetContribution,
        RotateKey,
        ReplaceRelayer,
        ReplaceAttestor
    }

    struct Member {
        address key;
        bytes32 beneficiaryHash;
        uint128 paidCents;
    }

    struct Config {
        address[] keys;
        bytes32[] beneficiaryHashes;
        address relayer;
        address attestor;
        uint256 contributionCents;
        uint64 firstRoundEndsAt;
        uint64 roundLength;
        uint64 timelock;
        bytes32 constitutionHash;
    }

    /// @notice A member signed the constitution.
    event MemberJoined(uint8 indexed memberId, address key);
    /// @notice A bank credit was recorded against a member for the current round.
    event ContributionRecorded(
        uint256 indexed round, uint8 indexed memberId, uint128 cents, bytes32 investecRef
    );
    /// @notice The attestor's signed Investec balance was accepted.
    event ReservesPosted(uint256 cents, uint64 at, uint256 owed);
    /// @notice A round closed. The relayer must now pay `cents` to this member's registered beneficiary.
    event PayoutDue(uint256 indexed round, uint8 indexed memberId, uint256 cents, bytes32 beneficiaryHash);
    /// @notice The relayer confirmed the bank payment for a round.
    event PayoutSettled(uint256 indexed round, uint8 indexed memberId, uint256 cents, bytes32 investecRef);
    /// @notice A new round started.
    event RoundOpened(uint256 indexed round, uint8 indexed recipientId, uint64 endsAt);
    event ProposalCreated(
        uint256 indexed id, Kind kind, uint256 value, uint8 memberId, address newAddr, address proposer
    );
    event Voted(uint256 indexed id, uint8 indexed memberId, address signer, uint8 yes);
    /// @notice A strict majority voted yes. The change can run once `eta` has passed.
    event ProposalQueued(uint256 indexed id, uint64 eta);
    event ProposalExecuted(uint256 indexed id);
    event ContributionChanged(uint256 oldCents, uint256 newCents);
    event KeyRotated(uint8 indexed memberId, address oldKey, address newKey);
    event RelayerReplaced(address oldRelayer, address newRelayer);
    event AttestorReplaced(address oldAttestor, address newAttestor);

    error NotRelayer(address caller);
    error NotMember(address signer);
    error NotMemberOrRelayer(address caller);
    error UnknownMember(uint8 memberId);
    error AlreadyRecorded(bytes32 investecRef);
    error AmountTooLarge(uint256 cents, uint256 max);
    error ZeroAmount();
    error BadAttestation();
    error ReservesStale(uint64 at, uint64 notBefore);
    error ReservesShort(uint256 held, uint256 owed);
    error RoundStillOpen(uint64 endsAt);
    error UnknownPayout(uint256 round);
    error WrongBeneficiary(uint256 round, uint8 memberId);
    error BadSignature();
    error AlreadyJoined(uint8 memberId);
    error BadNonce(uint256 expected, uint256 got);
    error AlreadyVoted(uint256 proposalId, uint8 memberId);
    error UnknownProposal(uint256 proposalId);
    error BadProposal();
    error KeyInUse(address key);
    error NotQueued(uint256 proposalId);
    error TimelockActive(uint64 eta);
    error AlreadyExecuted(uint256 proposalId);
    error ProposalExpired(uint256 proposalId);
    error BadConfig();

    /// @notice Record a credit that landed in the Investec account. Relayer only.
    /// @param memberId Zero based member index. Bank reference STK-03 is member 03, memberId 2.
    /// @param cents Amount in cents, at most R10,000.
    /// @param investecRef keccak256 of the Investec transaction id. Each one can be used once, ever.
    function recordContribution(uint8 memberId, uint128 cents, bytes32 investecRef) external;

    /// @notice Post the Investec balance, signed by the attestor with EIP-712 `Reserves(uint256 cents,uint64 at)`.
    /// @dev Anyone may submit. `at` must increase and can't be in the future.
    function postReserves(uint256 cents, uint64 at, bytes calldata sig) external;

    /// @notice Close the round and make the pot due to `round % members`. Anyone may call.
    /// @dev Needs reserves younger than an hour that cover pot plus unsettled payouts, and the round to be over.
    function closeRound() external;

    /// @notice Confirm the bank paid a round's payout. Relayer only.
    /// @param beneficiaryId Must hash to the member's registered beneficiaryHash.
    function confirmPayout(uint256 closedRound, bytes32 beneficiaryId, bytes32 investecRef) external;

    /// @notice Gasless signature of the constitution, EIP-712 `Join(string constitution)`.
    function joinBySig(bytes calldata sig) external;

    /// @notice Open a governance proposal. Members or the relayer.
    function propose(Kind kind, uint256 value, uint8 memberId, address newAddr) external returns (uint256 id);

    /// @notice Gasless vote, EIP-712 `Vote(uint256 proposalId,uint256 nonce)` signed by a member key.
    function voteBySig(uint256 proposalId, uint256 nonce, bytes calldata sig) external;

    /// @notice Apply a proposal once its timelock has passed. Anyone may call.
    function execute(uint256 proposalId) external;

    function members(uint256 memberId)
        external
        view
        returns (address key, bytes32 beneficiaryHash, uint128 paidCents);
    function memberCount() external view returns (uint256);
    function idOf(address key) external view returns (uint256);
    function seen(bytes32 investecRef) external view returns (bool);
    function nonces(address signer) external view returns (uint256);
    function relayer() external view returns (address);
    function attestor() external view returns (address);
    function round() external view returns (uint256);
    function roundEndsAt() external view returns (uint64);
    function pot() external view returns (uint256);
    function unsettled() external view returns (uint256);
    function totalIn() external view returns (uint256);
    function settledOut() external view returns (uint256);
    function reservesCents() external view returns (uint256);
    function reservesAt() external view returns (uint64);
    function contributionCents() external view returns (uint256);
}
