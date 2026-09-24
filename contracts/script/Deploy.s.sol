// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IStokvel} from "../src/IStokvel.sol";
import {Stokvel} from "../src/Stokvel.sol";
import {StokvelV1Vulnerable} from "../src/StokvelV1Vulnerable.sol";

/// @notice Deploys V2 (the real one) and V1 (for DEMO 5) and writes deployments/<chainId>.json.
///
/// Configuration comes from the environment, every value has a demo default:
///   MEMBERS_FILE           JSON with "keys" (6 addresses) and "beneficiaryIds" (6 bytes32). Written by cards/.
///   RELAYER, ATTESTOR      addresses. Default: Anvil accounts 1 and 2.
///   CONTRIBUTION_CENTS     default 500000 (R5,000)
///   FIRST_ROUND_ENDS_AT    unix seconds. Default: now + ROUND_LENGTH. Set it to a time during the talk
///                          on Base Sepolia, where time can't be warped.
///   ROUND_LENGTH           seconds, default 30 days
///   TIMELOCK               seconds, default 120 (say 48 hours in production)
///
/// Anvil:        forge script script/Deploy.s.sol --rpc-url anvil --broadcast
/// Base Sepolia: see docs/DEPLOY.md
contract Deploy is Script {
    // Anvil's public test mnemonic. These accounts hold nothing anywhere real.
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    function run() external {
        IStokvel.Config memory cfg = buildConfig();

        vm.startBroadcast();
        Stokvel v2 = new Stokvel(cfg);
        StokvelV1Vulnerable v1 = new StokvelV1Vulnerable(cfg);
        vm.stopBroadcast();

        console2.log("Stokvel (V2):            ", address(v2));
        console2.log("StokvelV1Vulnerable (V1):", address(v1));
        console2.log("relayer:                 ", cfg.relayer);
        console2.log("attestor:                ", cfg.attestor);
        console2.log("first round ends at:     ", cfg.firstRoundEndsAt);

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "stokvel", address(v2));
        vm.serializeAddress(json, "stokvelV1", address(v1));
        vm.serializeAddress(json, "relayer", cfg.relayer);
        vm.serializeAddress(json, "attestor", cfg.attestor);
        vm.serializeAddress(json, "members", cfg.keys);
        vm.serializeUint(json, "contributionCents", cfg.contributionCents);
        vm.serializeUint(json, "firstRoundEndsAt", cfg.firstRoundEndsAt);
        vm.serializeUint(json, "roundLength", cfg.roundLength);
        vm.serializeUint(json, "timelock", cfg.timelock);
        vm.serializeBytes32(json, "constitutionHash", cfg.constitutionHash);
        string memory out = vm.serializeUint(json, "deployedAtBlock", block.number);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("written:", path);
    }

    function buildConfig() public returns (IStokvel.Config memory cfg) {
        (cfg.keys, cfg.beneficiaryHashes) = members();
        cfg.relayer = vm.envOr("RELAYER", vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 1)));
        cfg.attestor = vm.envOr("ATTESTOR", vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 2)));
        cfg.contributionCents = vm.envOr("CONTRIBUTION_CENTS", uint256(500_000));
        cfg.roundLength = uint64(vm.envOr("ROUND_LENGTH", uint256(30 days)));
        cfg.firstRoundEndsAt = uint64(vm.envOr("FIRST_ROUND_ENDS_AT", block.timestamp + cfg.roundLength));
        cfg.timelock = uint64(vm.envOr("TIMELOCK", uint256(120)));
        cfg.constitutionHash = keccak256(bytes(vm.readFile("CONSTITUTION.md")));
    }

    /// @dev Member keys come from the card generator's file when there is one, else from the Anvil
    ///      mnemonic (accounts 3 to 8), so the whole thing runs with no cards printed.
    function members() public returns (address[] memory keys, bytes32[] memory hashes) {
        keys = new address[](6);
        hashes = new bytes32[](6);
        string memory file = vm.envOr("MEMBERS_FILE", string(""));
        if (bytes(file).length != 0) {
            string memory json = vm.readFile(file);
            keys = vm.parseJsonAddressArray(json, ".keys");
            bytes32[] memory ids = vm.parseJsonBytes32Array(json, ".beneficiaryIds");
            require(keys.length == 6 && ids.length == 6, "members file needs 6 keys and 6 beneficiaryIds");
            for (uint256 i; i < 6; ++i) {
                hashes[i] = keccak256(abi.encode(ids[i]));
            }
            return (keys, hashes);
        }
        string[6] memory names = ["Lerato", "Thabo", "Aisha", "Johan", "Priya", "Sipho"];
        for (uint256 i; i < 6; ++i) {
            keys[i] = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, uint32(3 + i)));
            // the mock bank uses the same ids, see relayer/src/mock/ledger.ts
            hashes[i] = keccak256(abi.encode(keccak256(abi.encodePacked("beneficiary:", names[i]))));
        }
    }
}
