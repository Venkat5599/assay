// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {FirmBidMarket} from "../src/FirmBidMarket.sol";
import {TestStable} from "../src/mocks/TestStable.sol";
import {Receivable} from "../src/interfaces/IAssetRegistry.sol";

/// @notice Adds the rest of the demonstration book to a seeded testnet.
///
/// @dev `Seed.s.sol` puts one load through the whole loop. A book of one shows
///      the mechanism but not the judgement: every state it can be in looks the
///      same when there is only one row. This adds the two that are missing.
///
///      The second load is deliberately left UNPRICED. Nobody bids, so it is
///      not financeable, and the interface says exactly that. It is the most
///      important row on the screen: the protocol's claim is that absence of a
///      bid is information rather than a failure state, and a book where every
///      load happens to be financed never tests the claim.
///
///      Run after Seed.s.sol, with the same addresses:
///        forge script script/SeedBook.s.sol:SeedBook \
///          --rpc-url botchain_testnet --legacy --broadcast
contract SeedBook is Script {
    function run() external {
        AssetRegistry registry = AssetRegistry(vm.envAddress("ASSET_REGISTRY"));
        FirmBidMarket market = FirmBidMarket(vm.envAddress("FIRM_BID_MARKET"));
        TestStable stable = TestStable(vm.envAddress("STABLE_TOKEN"));

        address me = msg.sender;

        vm.startBroadcast();

        stable.mint(me, 500_000e18);
        IERC20(address(stable)).approve(address(market), type(uint256).max);
        registry.setApprovalForAll(address(market), true);

        // A larger load on a longer term, contested twice. The second bid
        // improves the floor; the third holds the floor and undercuts on
        // premium, which is the other way a slot can legally change hands.
        uint256 contested = registry.register(
            me,
            Receivable({
                debtor: 0x000000000000000000000000000000000000dEaD,
                faceValue: 42_000e18,
                dueDate: uint64(block.timestamp + 120 days),
                registeredAt: 0,
                docHash: keccak256(abi.encodePacked("lading/testnet/seed/2"))
            })
        );
        market.openSlot(contested, 900e18);
        market.bid(contested, 31_500e18, 12e14);
        market.bid(contested, 33_600e18, 12e14);
        market.bid(contested, 33_600e18, 9e14);

        // Registered, slot open, and no bid will be placed against it.
        uint256 unpriced = registry.register(
            me,
            Receivable({
                debtor: 0x000000000000000000000000000000000000dEaD,
                faceValue: 7_800e18,
                dueDate: uint64(block.timestamp + 45 days),
                registeredAt: 0,
                docHash: keccak256(abi.encodePacked("lading/testnet/seed/3"))
            })
        );
        market.openSlot(unpriced, 150e18);

        vm.stopBroadcast();

        console2.log("contested asset  ", contested);
        console2.log("  currentFloor   ", market.currentFloor(contested));
        console2.log("  maxBorrow      ", market.maxBorrow(contested));
        console2.log("unpriced asset   ", unpriced);
        console2.log("  currentFloor   ", market.currentFloor(unpriced));
        console2.log("  maxBorrow      ", market.maxBorrow(unpriced));
    }
}
