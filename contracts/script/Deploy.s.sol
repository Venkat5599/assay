// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {FirmBidMarket} from "../src/FirmBidMarket.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {AllowlistCompliance} from "../src/compliance/AllowlistCompliance.sol";
import {ICompliance} from "../src/interfaces/ICompliance.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {IFirmBidMarket} from "../src/interfaces/IFirmBidMarket.sol";
import {ILoanVault} from "../src/interfaces/ILoanVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys LADING to BOT Chain mainnet (677).
///
/// @dev Ordering is forced by the wiring: compliance and registry have no
///      dependencies, the market needs both, and the vault and market hold
///      mutual references that can only be set once both exist.
///
///      Run:
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url $BOTCHAIN_RPC_URL --broadcast --verify
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        address stable = vm.envAddress("STABLE_TOKEN");

        vm.startBroadcast();

        AllowlistCompliance compliance = new AllowlistCompliance(deployer);
        AssetRegistry registry = new AssetRegistry(deployer, ICompliance(address(compliance)));

        FirmBidMarket market = new FirmBidMarket(
            deployer,
            IERC20(stable),
            IAssetRegistry(address(registry)),
            ICompliance(address(compliance))
        );

        LoanVault vault = new LoanVault(
            deployer,
            IERC20(stable),
            IAssetRegistry(address(registry)),
            ICompliance(address(compliance))
        );

        market.setLoanVault(ILoanVault(address(vault)));
        vault.setMarket(IFirmBidMarket(address(market)));

        // v1 ships permissionless; the gate exists so a jurisdiction can be
        // switched on without touching market logic.
        compliance.setOpenAccess(true);

        vm.stopBroadcast();

        console2.log("STABLE_TOKEN      ", stable);
        console2.log("AllowlistCompliance", address(compliance));
        console2.log("AssetRegistry     ", address(registry));
        console2.log("FirmBidMarket     ", address(market));
        console2.log("LoanVault         ", address(vault));
    }
}
