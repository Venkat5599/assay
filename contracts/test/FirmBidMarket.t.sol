// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";

import {FirmBidMarket} from "../src/FirmBidMarket.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {AllowlistCompliance} from "../src/compliance/AllowlistCompliance.sol";
import {ICompliance} from "../src/interfaces/ICompliance.sol";
import {IAssetRegistry, Receivable} from "../src/interfaces/IAssetRegistry.sol";
import {ILoanVault} from "../src/interfaces/ILoanVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLoanVault} from "./mocks/MockLoanVault.sol";

contract FirmBidMarketTest is Test {
    MockERC20 token;
    AllowlistCompliance compliance;
    AssetRegistry registry;
    FirmBidMarket market;
    MockLoanVault vault;

    address borrower = makeAddr("borrower");
    address uwA = makeAddr("uwA");
    address uwB = makeAddr("uwB");
    address uwC = makeAddr("uwC");

    uint256 assetId;

    function setUp() public {
        token = new MockERC20("Mock USD", "mUSD", 18);
        compliance = new AllowlistCompliance(address(this));
        compliance.setOpenAccess(true);

        registry = new AssetRegistry(address(this), ICompliance(address(compliance)));
        market = new FirmBidMarket(
            address(this),
            token,
            IAssetRegistry(address(registry)),
            ICompliance(address(compliance))
        );
        vault = new MockLoanVault(token);
        market.setLoanVault(ILoanVault(address(vault)));

        vm.prank(borrower);
        assetId = registry.register(
            borrower,
            Receivable({
                debtor: makeAddr("debtor"),
                faceValue: 180_000e18,
                dueDate: uint64(block.timestamp + 90 days),
                registeredAt: 0,
                docHash: keccak256("invoice-4471")
            })
        );

        token.mint(borrower, 100_000e18);
        vm.startPrank(borrower);
        token.approve(address(market), type(uint256).max);
        registry.setApprovalForAll(address(market), true);
        market.openSlot(assetId, 10_000e18);
        vm.stopPrank();
    }

    function _bid(address uw, uint256 floor, uint128 rate) internal {
        token.mint(uw, floor);
        vm.startPrank(uw);
        token.approve(address(market), floor);
        market.bid(assetId, floor, rate);
        vm.stopPrank();
    }

    /// @notice The core mechanism: a second underwriter displaces the first by
    ///         offering a strictly better floor, and the first is made whole.
    function test_contest_displacesIncumbentAndRefundsInFull() public {
        _bid(uwA, 140_000e18, 1e15);

        FirmBidMarket.Slot memory s1 = market.slots(assetId);
        assertEq(s1.underwriter, uwA, "uwA should hold the slot");
        assertEq(s1.floor, 140_000e18);
        assertEq(s1.escrow, 140_000e18, "INV-1");

        // let premium accrue
        vm.roll(block.number + 1000);

        uint256 balBefore = token.balanceOf(uwA);
        uint256 expectedRefund = s1.escrow; // + accrued, computed below

        _bid(uwB, 148_000e18, 1e15); // +5.7% floor, same rate

        FirmBidMarket.Slot memory s2 = market.slots(assetId);
        assertEq(s2.underwriter, uwB, "uwB should now hold the slot");
        assertEq(s2.floor, 148_000e18);
        assertEq(s2.escrow, 148_000e18, "INV-1");
        assertEq(s2.accrued, 0, "incoming underwriter starts at zero accrued");

        uint256 refunded = token.balanceOf(uwA) - balBefore;
        assertGe(refunded, expectedRefund, "INV-5: escrow returned");
        assertGt(refunded, expectedRefund, "INV-5: accrued premium also returned");
    }

    /// @notice A bid that is worse on either axis is rejected.
    function test_contest_rejectsWorseTerms() public {
        _bid(uwA, 140_000e18, 1e15);

        token.mint(uwB, 200_000e18);
        vm.startPrank(uwB);
        token.approve(address(market), type(uint256).max);

        // lower floor
        vm.expectRevert();
        market.bid(assetId, 139_000e18, 1e15);

        // higher rate
        vm.expectRevert();
        market.bid(assetId, 140_000e18, 2e15);

        // identical terms - no improvement
        vm.expectRevert();
        market.bid(assetId, 140_000e18, 1e15);

        vm.stopPrank();
    }

    /// @notice Improvement below the anti-griefing delta is rejected.
    function test_contest_rejectsDustImprovement() public {
        _bid(uwA, 140_000e18, 1e15);

        token.mint(uwB, 200_000e18);
        vm.startPrank(uwB);
        token.approve(address(market), type(uint256).max);
        // +0.01%, under the 0.25% minimum
        vm.expectRevert();
        market.bid(assetId, 140_014e18, 1e15);
        vm.stopPrank();
    }

    /// @notice Winning on rate alone is a valid contest.
    function test_contest_winsOnRateAlone() public {
        _bid(uwA, 140_000e18, 1e15);
        _bid(uwB, 140_000e18, 5e14); // same floor, half the premium

        assertEq(market.slots(assetId).underwriter, uwB);
    }

    /// @notice Premium streams from the borrower-funded reserve and is capped
    ///         by it, so accrual can never exceed what the market holds.
    function test_premiumAccrualIsBackedByReserve() public {
        // rate is a RAY fraction per block: 1e21/1e27 = 1e-6 of floor per block
        _bid(uwA, 100_000e18, 1e21);

        vm.roll(block.number + 1_000_000);
        market.tick(assetId);

        FirmBidMarket.Slot memory s = market.slots(assetId);
        assertEq(s.premiumReserve, 0, "reserve should be fully drained");
        assertEq(s.accrued, 10_000e18, "accrual capped at the funded reserve");
        assertGe(token.balanceOf(address(market)), market.totalLiabilities(), "INV-2");
    }

    /// @notice Default settlement is atomic and needs no market or oracle.
    function test_settleDefault_atomicNoOracle() public {
        _bid(uwA, 140_000e18, 1e15);

        vault.setDebt(assetId, 112_000e18);
        vault.setDefaulted(assetId, true);

        // Collateral is escrowed by `openSlot`, so the market already holds it.
        market.settleDefault(assetId);

        assertEq(registry.ownerOf(assetId), uwA, "asset delivered to underwriter");
        assertEq(vault.absorbed(assetId), 140_000e18, "lender received the floor");
        assertEq(market.slots(assetId).underwriter, address(0), "slot cleared");
        assertEq(market.totalLiabilities(), 0, "liabilities settled");
    }

    /// @notice A fraudulent asset attracts no bid, so no loan is possible.
    /// @dev The demo beat: rejection with no oracle, no committee, no vote.
    function test_noBid_meansNoCredit() public view {
        assertEq(market.slots(assetId).underwriter, address(0));
        assertEq(market.currentFloor(assetId), 0);
        assertEq(market.maxBorrow(assetId), 0, "no bid, no borrowing capacity");
    }
}
