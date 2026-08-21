// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {CounterpartyRegistry} from "../src/CounterpartyRegistry.sol";
import {Receivable} from "../src/interfaces/IAssetRegistry.sol";

/// @notice Originates on mainnet without escrowing anything.
///
/// @dev The half of `SeedMainnet.s.sol` that costs no settlement capital.
///
///      Registering a receivable moves no tokens - it records the obligor,
///      the face value, the due date and the document hash, and mints the
///      ownership token. Naming a counterparty moves no tokens either. Both
///      cost gas and nothing else, which is why they can run against a
///      deployment holding no USDT.
///
///      What it deliberately does NOT do is open a slot. `openSlot` requires a
///      non-zero premium reserve and escrows it, so a slot cannot be opened
///      against an empty balance - and faking one would be worse than not
///      having it. The receivable therefore sits registered and unpledged,
///      which is an honest state: an asset exists, and no underwriter has
///      committed capital to it yet.
///
///      Run:
///        export ASSET_REGISTRY=... COUNTERPARTY_REGISTRY=...
///        export OBLIGOR=0x... OBLIGOR_NAME="..." DOC_REF="..."
///        export FACE=18400 TERM_DAYS=90
///        forge script script/RegisterMainnet.s.sol:RegisterMainnet \
///          --rpc-url botchain --legacy --broadcast
contract RegisterMainnet is Script {
    function run() external {
        AssetRegistry registry = AssetRegistry(vm.envAddress("ASSET_REGISTRY"));
        address obligor = vm.envAddress("OBLIGOR");
        string memory docRef = vm.envString("DOC_REF");

        // Precision is read, never assumed. Bridged USDT is six decimals; an
        // assumed eighteen would register a receivable a million times the
        // intended size and would not revert.
        address stable = vm.envAddress("STABLE_TOKEN");
        uint256 unit = 10 ** IERC20Metadata(stable).decimals();
        uint256 face = vm.envOr("FACE", uint256(18_400)) * unit;
        uint64 termDays = uint64(vm.envOr("TERM_DAYS", uint256(90)));

        vm.startBroadcast();

        // Name the obligor before anything is recorded against it. Registered
        // is not verified: the two are separate acts, and this one only says
        // the entity is known.
        address ontology = vm.envOr("COUNTERPARTY_REGISTRY", address(0));
        if (ontology != address(0)) {
            CounterpartyRegistry reg = CounterpartyRegistry(ontology);
            if (!reg.isKnown(obligor)) {
                reg.register(
                    obligor,
                    vm.envOr("OBLIGOR_NAME", string("Unnamed obligor")),
                    CounterpartyRegistry.Role.Shipper,
                    vm.envOr("OBLIGOR_JURISDICTION", string("US")),
                    keccak256(bytes(docRef))
                );
                console2.log("counterparty recorded as Pending");
            }
        }

        uint256 assetId = registry.register(
            msg.sender,
            Receivable({
                debtor: obligor,
                faceValue: uint128(face),
                dueDate: uint64(block.timestamp) + termDays * 1 days,
                registeredAt: 0,
                docHash: keccak256(bytes(docRef))
            })
        );

        vm.stopBroadcast();

        console2.log("assetId", assetId);
        console2.log("face   ", face);
        console2.log("");
        console2.log("Registered and unpledged. Opening a slot escrows a premium,");
        console2.log("so it waits on settlement capital: see SEED_MAINNET.md.");
    }
}
