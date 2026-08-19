// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {FirmBidMarket} from "../src/FirmBidMarket.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {AllowlistCompliance} from "../src/compliance/AllowlistCompliance.sol";
import {ICompliance} from "../src/interfaces/ICompliance.sol";
import {IAssetRegistry, Receivable} from "../src/interfaces/IAssetRegistry.sol";
import {IFirmBidMarket} from "../src/interfaces/IFirmBidMarket.sol";
import {ILoanVault} from "../src/interfaces/ILoanVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice End-to-end tests over the real vault wired to the real market.
/// @dev The unit suite exercises the market against a mock vault. This suite
///      exists to catch what a mock cannot: the two contracts reading each
///      other's state within a single call.
contract LoanVaultTest is Test {
    MockERC20 token;
    AllowlistCompliance compliance;
    AssetRegistry registry;
    FirmBidMarket market;
    LoanVault vault;

    address carrier = makeAddr("carrier");
    address lender = makeAddr("lender");
    address uwA = makeAddr("uwA");
    address uwB = makeAddr("uwB");

    uint256 assetId;
    uint64 dueDate;

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
        vault = new LoanVault(
            address(this),
            token,
            IAssetRegistry(address(registry)),
            ICompliance(address(compliance))
        );

        market.setLoanVault(ILoanVault(address(vault)));
        vault.setMarket(IFirmBidMarket(address(market)));

        dueDate = uint64(block.timestamp + 60 days);

        vm.prank(carrier);
        assetId = registry.register(
            carrier,
            Receivable({
                debtor: makeAddr("shipper"),
                faceValue: 100_000e18,
                dueDate: dueDate,
                registeredAt: 0,
                docHash: keccak256("bol-88213")
            })
        );

        for (uint256 i; i < 4; ++i) {
            address a = [carrier, lender, uwA, uwB][i];
            token.mint(a, 1_000_000e18);
            vm.startPrank(a);
            token.approve(address(market), type(uint256).max);
            token.approve(address(vault), type(uint256).max);
            registry.setApprovalForAll(address(market), true);
            vm.stopPrank();
        }

        vm.prank(lender);
        vault.deposit(500_000e18);

        vm.prank(carrier);
        market.openSlot(assetId, 10_000e18);
    }

    function _bid(address uw, uint256 floor, uint128 rate) internal {
        vm.prank(uw);
        market.bid(assetId, floor, rate);
    }

    // ------------------------------------------------------------ the loop

    function test_fullLoop_borrowThenRepay() public {
        _bid(uwA, 90_000e18, 1e15);

        uint256 room = vault.availableToBorrow(assetId);
        assertEq(room, 72_000e18, "80% of a 90k floor");

        vm.prank(carrier);
        vault.borrow(assetId, room);
        assertEq(token.balanceOf(carrier), 1_000_000e18 - 10_000e18 + room);
        assertEq(vault.outstanding(assetId), room);

        vm.roll(block.number + 5_000);

        uint256 debt = vault.outstanding(assetId);
        assertGt(debt, room, "interest accrued");

        vm.prank(carrier);
        vault.repay(assetId, debt);

        assertEq(vault.outstanding(assetId), 0);
        assertEq(vault.loans(assetId).borrower, address(0), "loan closed");
        assertGt(vault.totalAssets(), 500_000e18, "lenders earned interest");
    }

    /// @dev The headline claim: default settles in one block with no auction,
    ///      no oracle, and no secondary market.
    function test_fullLoop_defaultSettlesAtomically() public {
        _bid(uwA, 90_000e18, 1e15);

        vm.prank(carrier);
        vault.borrow(assetId, 72_000e18);

        vm.roll(block.number + 1_000);
        vm.warp(dueDate + vault.gracePeriod() + 1);
        assertTrue(vault.isDefaulted(assetId), "matured unpaid");

        uint256 lenderAssetsBefore = vault.totalAssets();
        uint256 uwBalBefore = token.balanceOf(uwA);

        market.settleDefault(assetId);

        assertEq(registry.ownerOf(assetId), uwA, "invoice to underwriter");
        assertEq(vault.outstanding(assetId), 0, "debt cleared");
        assertEq(vault.badDebt(), 0, "lenders made whole");
        assertGe(vault.totalAssets(), lenderAssetsBefore, "pool did not shrink");
        // Net outlay is the purchase price less the premium they earned.
        assertLt(token.balanceOf(uwA), 930_000e18, "underwriter paid ~90k for the asset");
        assertGt(token.balanceOf(uwA), uwBalBefore, "and kept the premium they earned");

        // Sale proceeds above the debt belong to the borrower, not the pool.
        assertGt(vault.claimable(carrier), 0, "surplus owed to carrier");
        vm.prank(carrier);
        vault.claimSurplus();
    }

    // -------------------------------------------------------- risk triggers

    /// @notice Decay in isolation, with interest switched off.
    ///
    /// @dev THIS TEST EXISTS BECAUSE ITS SIBLING LIED.
    ///      `test_maturesIntoDefaultWithoutMaturity` below rolls a huge number
    ///      of blocks and asserts the position became callable. It passed for
    ///      the entire life of the previous build - while `Slot.decayRate` was
    ///      never assigned and the floor never moved once. Compounding interest
    ///      was quietly doing all the work and the assertion could not tell the
    ///      difference.
    ///
    ///      So this one removes the confound: `ratePerBlock = 0` freezes the
    ///      debt, and the only thing left that can breach coverage is the floor
    ///      falling on its own. If decay is ever unwired again, this fails and
    ///      the sibling does not.
    function test_decayAloneMakesPositionCallable() public {
        vault.setParameters(0, 3 days); // freeze interest: isolate decay

        _bid(uwA, 90_000e18, 1e15);
        uint256 floorBefore = market.currentFloor(assetId);

        // Draw 90% of headroom, not all of it. At the cap any decay whatsoever
        // breaches instantly, which would prove the clamp works but say nothing
        // about the rate actually being applied.
        uint256 draw = vault.availableToBorrow(assetId) * 90 / 100;
        vm.prank(carrier);
        vault.borrow(assetId, draw);

        assertFalse(vault.isDefaulted(assetId), "healthy at origination");

        // ~45 days of 0.75s blocks, uncontested.
        vm.roll(block.number + 115_200 * 45);

        assertEq(vault.outstanding(assetId), draw, "debt frozen - decay is the only mover");
        assertLt(market.currentFloor(assetId), floorBefore, "floor fell with nobody contesting");
        assertTrue(vault.isDefaulted(assetId), "coverage breached by decay alone");
        assertLt(block.timestamp, dueDate, "and maturity never arrived");
    }

    /// @notice A contest restates the bid and resets the erosion.
    /// @dev Decay must punish a stale opinion, not a live one. If restating the
    ///      bid did not reset the floor, holding a slot honestly would still
    ///      bleed the borrower's headroom away.
    function test_contestResetsDecay() public {
        vault.setParameters(0, 3 days);
        _bid(uwA, 90_000e18, 1e15);

        vm.roll(block.number + 115_200 * 45);
        uint256 decayed = market.currentFloor(assetId);
        assertLt(decayed, 90_000e18, "floor eroded while uncontested");

        _bid(uwB, 95_000e18, 1e15);
        assertEq(market.currentFloor(assetId), 95_000e18, "contest restates the floor in full");
        assertEq(market.slots(assetId).lastTick, uint64(block.number), "erosion clock reset");
    }

    /// @dev The ceiling is a real guard, and lowering it must drag a live rate
    ///      down with it rather than leaving one stranded above the bound.
    function test_decayRateIsBounded() public {
        uint128 ceiling = market.maxDecayRate();
        vm.expectRevert(
            abi.encodeWithSelector(FirmBidMarket.DecayTooHigh.selector, ceiling + 1, ceiling)
        );
        market.setDecayRate(ceiling + 1);

        market.setParameters(25, 2_000, 1e15);
        assertLe(market.decayRatePerBlock(), 1e15, "live rate dragged under the new ceiling");
    }

    /// @dev Governance-free deleveraging: an uncontested floor decays until
    ///      headroom vanishes, and the position becomes callable with no vote.
    ///      Both forces are live here - decay and interest - which is why the
    ///      isolated test above exists alongside it.
    function test_maturesIntoDefaultWithoutMaturity() public {
        _bid(uwA, 90_000e18, 1e15);

        uint256 room = vault.availableToBorrow(assetId);
        vm.prank(carrier);
        vault.borrow(assetId, room);
        assertFalse(vault.isDefaulted(assetId), "healthy at origination");

        vm.roll(block.number + 400_000_000);

        assertTrue(vault.isDefaulted(assetId), "coverage breach, before maturity");
        assertLt(block.timestamp, dueDate, "and maturity has not arrived");
    }

    function test_cannotBorrowBeyondHeadroom() public {
        _bid(uwA, 90_000e18, 1e15);
        uint256 room = vault.availableToBorrow(assetId);

        vm.prank(carrier);
        vm.expectRevert(abi.encodeWithSelector(LoanVault.ExceedsHeadroom.selector, room + 1, room));
        vault.borrow(assetId, room + 1);
    }

    function test_contestRaisesHeadroom() public {
        _bid(uwA, 90_000e18, 1e15);
        uint256 before = vault.availableToBorrow(assetId);

        _bid(uwB, 95_000e18, 1e15);

        assertGt(vault.availableToBorrow(assetId), before, "better bid, more credit");
        assertEq(market.slots(assetId).underwriter, uwB, "incumbent displaced");
    }

    function test_onlyMarketCanAbsorbSettlement() public {
        vm.expectRevert(abi.encodeWithSelector(LoanVault.NotMarket.selector, address(this)));
        vault.absorbSettlement(assetId, 1e18);
    }

    function test_noBidMeansNoCredit() public {
        assertEq(vault.availableToBorrow(assetId), 0, "unpriced asset is unlendable");

        vm.prank(carrier);
        vm.expectRevert(abi.encodeWithSelector(LoanVault.ExceedsHeadroom.selector, 1e18, 0));
        vault.borrow(assetId, 1e18);
    }

    // ------------------------------------------------------------- lenders

    function test_withdrawBoundedByIdleCash() public {
        _bid(uwA, 90_000e18, 1e15);

        vm.prank(carrier);
        vault.borrow(assetId, 72_000e18);

        uint256 all = vault.sharesOf(lender);
        uint256 want = vault.convertToAssets(all);

        vm.prank(lender);
        vm.expectRevert(
            abi.encodeWithSelector(
                LoanVault.InsufficientLiquidity.selector, want, vault.totalIdle()
            )
        );
        vault.withdraw(all);
    }

    function testFuzz_repayNeverIncreasesDebt(uint96 amount) public {
        _bid(uwA, 90_000e18, 1e15);
        vm.prank(carrier);
        vault.borrow(assetId, 72_000e18);

        vm.roll(block.number + 1_000);
        uint256 before = vault.outstanding(assetId);

        uint256 pay = bound(uint256(amount), 1, before);
        vm.prank(carrier);
        vault.repay(assetId, pay);

        assertLe(vault.outstanding(assetId), before, "repayment is monotonic");
    }
}
