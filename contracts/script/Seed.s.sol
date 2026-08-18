// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {FirmBidMarket} from "../src/FirmBidMarket.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {TestStable} from "../src/mocks/TestStable.sol";
import {Receivable} from "../src/interfaces/IAssetRegistry.sol";

/// @notice Puts one real load through the whole loop on testnet, so the
///         deployed system is demonstrably live rather than merely deployed.
///
/// @dev Registers a bill of lading, opens a contestable slot, seeds pool
///      liquidity, and places two competing firm bids. The second bid displaces
///      the first, which is the mechanism's headline behaviour and the thing
///      worth seeing on a block explorer.
contract Seed is Script {
    function run() external {
        AssetRegistry registry = AssetRegistry(vm.envAddress("ASSET_REGISTRY"));
        FirmBidMarket market = FirmBidMarket(vm.envAddress("FIRM_BID_MARKET"));
        LoanVault vault = LoanVault(vm.envAddress("LOAN_VAULT"));
        TestStable stable = TestStable(vm.envAddress("STABLE_TOKEN"));

        address me = msg.sender;

        vm.startBroadcast();

        stable.mint(me, 2_000_000e18);
        IERC20(address(stable)).approve(address(market), type(uint256).max);
        IERC20(address(stable)).approve(address(vault), type(uint256).max);

        // BOL-88213: bulk corn, Cedar Rapids -> Kansas City, net 90.
        uint256 assetId = registry.register(
            me,
            Receivable({
                debtor: 0x000000000000000000000000000000000000dEaD,
                faceValue: 18_400e18,
                dueDate: uint64(block.timestamp + 90 days),
                registeredAt: 0,
                docHash: keccak256("BOL-88213/midwest-grain/2026-08-11")
            })
        );

        registry.setApprovalForAll(address(market), true);
        market.openSlot(assetId, 400e18);

        // Lender capital, so the carrier has something to draw.
        vault.deposit(500_000e18);

        // Two firm bids. The second is strictly better and displaces the first.
        market.bid(assetId, 14_720e18, 1e15);
        market.bid(assetId, 15_640e18, 1e15);

        vm.stopBroadcast();

        console2.log("assetId          ", assetId);
        console2.log("currentFloor     ", market.currentFloor(assetId));
        console2.log("maxBorrow        ", market.maxBorrow(assetId));
        console2.log("availableToBorrow", vault.availableToBorrow(assetId));
    }
}
