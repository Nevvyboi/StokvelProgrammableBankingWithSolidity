// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IStokvel} from "../src/IStokvel.sol";
import {Stokvel} from "../src/Stokvel.sol";

/// @dev Shared setup: six fictional members, a relayer, an attestor, and EIP-712 signing helpers.
abstract contract Fixture is Test {
    string[6] internal NAMES = ["Lerato", "Thabo", "Aisha", "Johan", "Priya", "Sipho"];
    uint256 internal constant CONTRIBUTION = 500_000; // R5,000
    uint64 internal constant ROUND_LENGTH = 30 days;
    uint64 internal constant TIMELOCK = 120;

    uint256[6] internal memberPk;
    address[6] internal memberKey;
    bytes32[6] internal beneficiaryId;

    uint256 internal relayerPk = 0xA11CE;
    uint256 internal attestorPk = 0xB0B;
    address internal relayer;
    address internal attestor;
    address internal stranger = address(0x5afe);

    bytes32 internal constant CONSTITUTION = keccak256("The Q4 Stokvel constitution, v1");

    Stokvel internal s;
    uint64 internal start;

    bytes32 private constant RESERVES_TYPEHASH = keccak256("Reserves(uint256 cents,uint64 at)");
    bytes32 private constant VOTE_TYPEHASH = keccak256("Vote(uint256 proposalId,uint256 nonce)");
    bytes32 private constant JOIN_TYPEHASH = keccak256("Join(string constitution)");

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        start = uint64(block.timestamp);
        relayer = vm.addr(relayerPk);
        attestor = vm.addr(attestorPk);
        for (uint256 i; i < 6; ++i) {
            memberPk[i] = uint256(keccak256(abi.encodePacked("member", i)));
            memberKey[i] = vm.addr(memberPk[i]);
            beneficiaryId[i] = keccak256(abi.encodePacked("investec-beneficiary-", NAMES[i]));
            vm.label(memberKey[i], NAMES[i]);
        }
        vm.label(relayer, "relayer");
        vm.label(attestor, "attestor");
        s = Stokvel(deploy(address(0)));
    }

    /// @dev Deploys a Stokvel (or any contract with the same constructor) with the standard config.
    function deploy(address impl) internal returns (address) {
        IStokvel.Config memory cfg = config();
        if (impl == address(0)) return address(new Stokvel(cfg));
        return impl;
    }

    function config() internal view returns (IStokvel.Config memory cfg) {
        cfg.keys = new address[](6);
        cfg.beneficiaryHashes = new bytes32[](6);
        for (uint256 i; i < 6; ++i) {
            cfg.keys[i] = memberKey[i];
            cfg.beneficiaryHashes[i] = keccak256(abi.encode(beneficiaryId[i]));
        }
        cfg.relayer = relayer;
        cfg.attestor = attestor;
        cfg.contributionCents = CONTRIBUTION;
        cfg.firstRoundEndsAt = start + ROUND_LENGTH;
        cfg.roundLength = ROUND_LENGTH;
        cfg.timelock = TIMELOCK;
        cfg.constitutionHash = CONSTITUTION;
    }

    // ------------------------------------------------------------ signing helpers

    function domain(address verifying) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Stokvel"),
                keccak256("1"),
                block.chainid,
                verifying
            )
        );
    }

    function digest(address verifying, bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domain(verifying), structHash));
    }

    function sign(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sVal) = vm.sign(pk, d);
        return abi.encodePacked(r, sVal, v);
    }

    function signReserves(address verifying, uint256 pk, uint256 cents, uint64 at)
        internal
        view
        returns (bytes memory)
    {
        return sign(pk, digest(verifying, keccak256(abi.encode(RESERVES_TYPEHASH, cents, at))));
    }

    function signVote(address verifying, uint256 pk, uint256 proposalId, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        return sign(pk, digest(verifying, keccak256(abi.encode(VOTE_TYPEHASH, proposalId, nonce))));
    }

    function signJoin(address verifying, uint256 pk) internal view returns (bytes memory) {
        return sign(pk, digest(verifying, keccak256(abi.encode(JOIN_TYPEHASH, CONSTITUTION))));
    }

    // ------------------------------------------------------------ flow helpers

    function ref(string memory id) internal pure returns (bytes32) {
        return keccak256(bytes(id));
    }

    function contribute(uint8 memberId, uint128 cents, string memory investecTxId) internal {
        vm.prank(relayer);
        s.recordContribution(memberId, cents, ref(investecTxId));
    }

    /// @dev Attestations must carry a strictly increasing timestamp, so a second one in the same
    ///      second moves the clock on by one, the way a real relayer's next poll would.
    function attest(uint256 cents) internal {
        if (block.timestamp <= s.reservesAt()) vm.warp(s.reservesAt() + 1);
        attestAt(cents, uint64(block.timestamp));
    }

    function attestAt(uint256 cents, uint64 at) internal {
        s.postReserves(cents, at, signReserves(address(s), attestorPk, cents, at));
    }

    /// @dev Every member pays once, the bank balance is attested, time moves to month end.
    function fullMonth(uint256 monthNo) internal {
        for (uint8 i; i < 6; ++i) {
            contribute(
                i, uint128(CONTRIBUTION), string(abi.encodePacked("tx-", vm.toString(monthNo), "-", NAMES[i]))
            );
        }
        vm.warp(s.roundEndsAt());
        attest(s.pot() + s.unsettled());
    }

    function voteSig(uint256 proposalId, uint256 memberIdx)
        internal
        view
        returns (uint256 nonce, bytes memory sig)
    {
        nonce = s.nonces(memberKey[memberIdx]);
        sig = signVote(address(s), memberPk[memberIdx], proposalId, nonce);
    }

    function vote(uint256 proposalId, uint256 memberIdx) internal {
        (uint256 nonce, bytes memory sig) = voteSig(proposalId, memberIdx);
        s.voteBySig(proposalId, nonce, sig);
    }
}
