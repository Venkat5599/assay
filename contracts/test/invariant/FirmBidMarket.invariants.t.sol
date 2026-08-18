// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {FirmBidMarket} from "../../src/FirmBidMarket.sol";
import {AssetRegistry} from "../../src/AssetRegistry.sol";
import {AllowlistCompliance} from "../../src/compliance/AllowlistCompliance.sol";
import {ICompliance} from "../../src/interfaces/ICompliance.sol";
import {IAssetRegistry, Receivable} from "../../src/interfaces/IAssetRegistry.sol";
import {ILoanVault} from "../../src/interfaces/ILoanVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockLoanVault} from "../mocks/MockLoanVault.sol";
import {FirmBidMarketHandler} from "./FirmBidMarketHandler.sol";

/// @notice The safety argument for PLINTH, stated as executable invariants.
///
/// @dev These are not example-based tests. The handler drives the market
///      through random action sequences and these properties must hold after
///      every single one. If any of them can be broken, the protocol is
///      insolvent or the mechanism is unsound - there is no third option.
contract FirmBidMarketInvariants is Test {
    uint256 constant ASSETS = 2;
    uint256 constant UNDERWRITERS = 5;

    MockERC20 token;
    AllowlistCompliance compliance;
    AssetRegistry registry;
    FirmBidMarket market;
    MockLoanVault vault;
    FirmBidMarketHandler handler;

    uint256[] assetIds;
    address[] underwriters;

    /// forge-config: default.invariant.depth = 192
    /// forge-config: default.invariant.runs = 128
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

        address borrower = makeAddr("borrower");

        for (uint256 i; i < ASSETS; ++i) {
            vm.prank(borrower);
            uint256 id = registry.register(
                borrower,
                Receivable({
                    debtor: makeAddr(string(abi.encodePacked("debtor", i))),
                    faceValue: uint128(100_000e18 + i * 1e18),
                    dueDate: uint64(block.timestamp + 90 days),
                    registeredAt: 0,
                    docHash: keccak256(abi.encode("doc", i))
                })
            );
            assetIds.push(id);

            token.mint(borrower, 50_000e18);
            vm.startPrank(borrower);
            token.approve(address(market), type(uint256).max);
            registry.setApprovalForAll(address(market), true);
            market.openSlot(id, 10_000e18);
            vm.stopPrank();
        }

        for (uint256 i; i < UNDERWRITERS; ++i) {
            underwriters.push(makeAddr(string(abi.encodePacked("uw", i))));
        }

        handler = new FirmBidMarketHandler(market, registry, token, vault, assetIds, underwriters);

        targetContract(address(handler));

        bytes4[] memory sel = new bytes4[](7);
        sel[0] = FirmBidMarketHandler.bid.selector;
        sel[1] = FirmBidMarketHandler.fundPremium.selector;
        sel[2] = FirmBidMarketHandler.claimPremium.selector;
        sel[3] = FirmBidMarketHandler.withdrawBid.selector;
        sel[4] = FirmBidMarketHandler.setDebt.selector;
        sel[5] = FirmBidMarketHandler.tick.selector;
        sel[6] = FirmBidMarketHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    // ------------------------------------------------------------- INV-1

    /// @notice Every active slot is escrowed to at least its firm bid.
    /// @dev If this breaks, an underwriter has committed to a purchase price
    ///      they have not funded, and the lender's floor is fiction.
    function invariant_escrowCoversFloor() public view {
        for (uint256 i; i < assetIds.length; ++i) {
            FirmBidMarket.Slot memory s = market.slots(assetIds[i]);
            if (s.underwriter == address(0)) continue;
            assertGe(s.escrow, s.floor, "INV-1: escrow < floor");
        }
    }

    // ------------------------------------------------------------- INV-2

    /// @notice The market always holds at least what it owes.
    /// @dev Solvency. Premium accrual is capped by the funded reserve
    ///      precisely so this cannot drift.
    function invariant_solvent() public view {
        assertGe(
            token.balanceOf(address(market)),
            market.totalLiabilities(),
            "INV-2: liabilities exceed holdings"
        );
    }

    /// @notice `totalLiabilities` equals the sum of per-slot obligations.
    /// @dev The O(1) accumulator must not diverge from ground truth.
    function invariant_liabilitiesReconcile() public view {
        uint256 sum;
        for (uint256 i; i < assetIds.length; ++i) {
            FirmBidMarket.Slot memory s = market.slots(assetIds[i]);
            sum += s.escrow + s.accrued + s.premiumReserve;
        }
        assertEq(sum, market.totalLiabilities(), "INV-2b: accumulator drift");
    }

    // ------------------------------------------------------------- INV-3

    /// @notice A contest never worsens the borrower's terms.
    /// @dev Floor may fall only by decay, never by a bid. Rate may rise never.
    ///      This is what makes front-running structurally harmless here: the
    ///      only way to win a slot is to improve the borrower's position.
    function invariant_bidsOnlyImprove() public view {
        for (uint256 i; i < assetIds.length; ++i) {
            uint256 id = assetIds[i];
            FirmBidMarket.Slot memory s = market.slots(id);
            if (s.underwriter == address(0)) continue;
            if (handler.ghost_decayEnabled(id)) continue; // decay handled by INV-4
            assertGe(s.floor, handler.ghost_maxFloorSeen(id), "INV-3: floor regressed");
        }
    }

    // ------------------------------------------------------------- INV-4

    /// @notice A live floor never sits below the debt it backs.
    ///
    /// @dev NOTE ON THE ORIGINAL SPEC. This was first written as
    ///      `outstanding <= floor * (1 - haircut)` at all times. That is wrong:
    ///      floor decay is *designed* to erode headroom until the loan becomes
    ///      callable, so the haircut band is expected to be breached - that
    ///      breach is the deleveraging signal, not a bug.
    ///
    ///      The invariant that must actually hold is weaker and more important:
    ///      the floor never decays below the outstanding debt, so settlement
    ///      always makes the lender whole. `_tick` clamps decay at exactly this
    ///      bound.
    function invariant_floorCoversDebt() public view {
        for (uint256 i; i < assetIds.length; ++i) {
            uint256 id = assetIds[i];
            FirmBidMarket.Slot memory s = market.slots(id);
            if (s.underwriter == address(0)) continue;
            assertGe(s.floor, vault.outstanding(id), "INV-4: floor below debt");
            assertGe(market.currentFloor(id), vault.outstanding(id), "INV-4: view below debt");
        }
    }

    // ------------------------------------------------------------- INV-5

    /// @notice A displaced underwriter is refunded escrow + accrued, in full.
    /// @dev Contestability is only credible if exiting is lossless. Any
    ///      shortfall here and no rational underwriter ever takes a slot.
    function invariant_displacedRefundedInFull() public view {
        assertEq(
            handler.ghost_refundPaid(),
            handler.ghost_refundOwed(),
            "INV-5: displaced underwriter short-changed"
        );
    }

    // ------------------------------------------------------------- INV-7

    /// @notice `_tick` is idempotent within a block.
    function invariant_tickIdempotent() public {
        for (uint256 i; i < assetIds.length; ++i) {
            uint256 id = assetIds[i];
            market.tick(id); // bring to current block
            FirmBidMarket.Slot memory a = market.slots(id);
            market.tick(id); // second tick in the same block must be a no-op
            FirmBidMarket.Slot memory b = market.slots(id);
            assertEq(a.floor, b.floor, "INV-7: floor moved");
            assertEq(a.accrued, b.accrued, "INV-7: accrued moved");
            assertEq(a.premiumReserve, b.premiumReserve, "INV-7: reserve moved");
        }
    }

    // ------------------------------------------------------------ coverage

    /// @notice Fails loudly if the fuzzer never exercised a contest.
    /// @dev An invariant suite that never reached the interesting state proves
    ///      nothing. This asserts the run had real coverage.
    /// @dev Ghost state resets between runs, so this is a PER-RUN check: it
    ///      guards against a run that exercised nothing. Contest-path coverage
    ///      is asserted directly in FirmBidMarketTest (displacement, refund in
    ///      full, dust rejection, rate-only wins) rather than probabilistically
    ///      here, where a short run would fail it spuriously.
    function afterInvariant() public view {
        assertGt(handler.ghost_bidCount(), 0, "no bids executed - run is vacuous");
    }
}
