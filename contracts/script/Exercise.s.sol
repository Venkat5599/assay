// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FirmBidMarket} from "../src/FirmBidMarket.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {TestStable} from "../src/mocks/TestStable.sol";

/// @notice Puts the deployed protocol into a working operational state.
///
/// @dev A console that reads a chain where nothing has happened looks staged
///      even when every figure is genuine - every operational metric resolves
///      to zero. This exercises the loop so utilisation, coverage and the loan
///      book carry real, non-round numbers produced by real transactions.
///
///      Draw sizes are deliberately uneven: a desk that draws exactly its
///      maximum on every facility is not a book, it is a fixture.
contract Exercise is Script {
    function run() external {
        FirmBidMarket market = FirmBidMarket(vm.envAddress("FIRM_BID_MARKET"));
        LoanVault vault = LoanVault(vm.envAddress("LOAN_VAULT"));
        TestStable stable = TestStable(vm.envAddress("STABLE_TOKEN"));

        vm.startBroadcast();

        IERC20(address(stable)).approve(address(vault), type(uint256).max);

        // Asset 1: near the cap. A carrier taking everything available.
        _draw(vault, 1, 92);

        // Asset 2: a partial draw, then a repayment against it.
        _draw(vault, 2, 61);
        uint256 debt2 = vault.outstanding(2);
        if (debt2 > 0) {
            uint256 pay = debt2 / 4;
            vault.repay(2, pay);
            console2.log("repaid on 2  ", pay);
        }

        // Asset 3: a light draw on the largest facility.
        _draw(vault, 3, 38);

        vm.stopBroadcast();

        for (uint256 i = 1; i <= 3; i++) {
            console2.log("asset", i);
            console2.log("  floor      ", market.currentFloor(i));
            console2.log("  outstanding", vault.outstanding(i));
            console2.log("  drawable   ", vault.availableToBorrow(i));
        }
        console2.log("pool total ", vault.totalAssets());
        console2.log("pool idle  ", vault.totalIdle());
    }

    /// @dev Draws `pctOfRoom` percent of what the vault will currently lend.
    function _draw(LoanVault vault, uint256 assetId, uint256 pctOfRoom) internal {
        uint256 room = vault.availableToBorrow(assetId);
        if (room == 0) return;
        uint256 amount = (room * pctOfRoom) / 100;
        vault.borrow(assetId, amount);
        console2.log("drew on", assetId, amount);
    }
}
