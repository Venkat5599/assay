// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {FirmBidMarket} from "../../src/FirmBidMarket.sol";
import {AssetRegistry} from "../../src/AssetRegistry.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockLoanVault} from "../mocks/MockLoanVault.sol";

/// @notice Stateful fuzzing harness. Drives the market through random but
///         well-formed action sequences so the invariants below are exercised
///         against real state transitions rather than isolated calls.
contract FirmBidMarketHandler is CommonBase, StdCheats, StdUtils {
    FirmBidMarket public immutable market;
    AssetRegistry public immutable registry;
    MockERC20 public immutable token;
    MockLoanVault public immutable vault;

    uint256[] public assetIds;
    address[] public underwriters;

    // ---- ghost variables: what the handler believes should be true

    /// @notice Highest floor ever observed on a slot. INV-3 asserts the live
    ///         floor never falls below this except by decay, which is tracked
    ///         separately via `ghost_decayEnabled`.
    mapping(uint256 => uint256) public ghost_maxFloorSeen;
    /// @notice Floor written by the MOST RECENT accepted bid on a slot.
    /// @dev Recorded at bid time, so decay cannot confound it. INV-3 compares
    ///      it against the live floor to assert nothing but a bid raises one.
    mapping(uint256 => uint256) public ghost_lastBidFloor;

    /// @notice Count of accepted bids that did NOT improve on the floor they
    ///         displaced, measured against that floor as it stood at the time.
    ///
    /// @dev The reference point matters, and getting it wrong is easy. An
    ///      all-time-high floor is NOT the bar a contest must clear: decay
    ///      erodes a standing bid, and once it has eroded, a bid below the old
    ///      peak can still be strictly better than the commitment actually on
    ///      the table. Judging against the peak would fail a contest that is
    ///      working exactly as designed. The real rule - the one `bid()`
    ///      enforces - is local: beat what stands, when you bid.
    uint256 public ghost_nonImprovingBids;
    mapping(uint256 => uint256) public ghost_minRateSeen;
    mapping(uint256 => bool) public ghost_decayEnabled;

    /// @notice Total refunded to displaced underwriters, and what was owed.
    uint256 public ghost_refundPaid;
    uint256 public ghost_refundOwed;

    uint256 public ghost_bidCount;
    uint256 public ghost_contestCount;

    constructor(
        FirmBidMarket m,
        AssetRegistry r,
        MockERC20 t,
        MockLoanVault v,
        uint256[] memory ids,
        address[] memory uws
    ) {
        market = m;
        registry = r;
        token = t;
        vault = v;
        assetIds = ids;
        underwriters = uws;
    }

    function _asset(uint256 seed) internal view returns (uint256) {
        return assetIds[seed % assetIds.length];
    }

    function _uw(uint256 seed) internal view returns (address) {
        return underwriters[seed % underwriters.length];
    }

    // ------------------------------------------------------------- actions

    function bid(uint256 assetSeed, uint256 uwSeed, uint256 floorSeed, uint256 rateSeed) external {
        uint256 id = _asset(assetSeed);
        address uw = _uw(uwSeed);

        // settle accrual first: `bid()` ticks internally, so a pre-tick
        // snapshot under-counts what the displaced party is actually owed
        market.tick(id);
        FirmBidMarket.Slot memory s = market.slots(id);
        if (!s.open) return;

        // build a bid that has a real chance of being accepted
        uint256 curFloor = s.floor;
        uint256 newFloor = curFloor == 0
            ? bound(floorSeed, 1e18, 1_000_000e18)
            : curFloor + bound(floorSeed, curFloor / 50 + 1, curFloor / 2 + 1);

        uint128 curRate = s.premiumRate;
        uint128 newRate =
            curRate == 0 ? uint128(bound(rateSeed, 0, 1e18)) : uint128(bound(rateSeed, 0, curRate));

        address prev = s.underwriter;
        uint256 owedBefore = s.escrow + s.accrued;
        uint256 prevBalBefore = prev == address(0) ? 0 : token.balanceOf(prev);

        token.mint(uw, newFloor);
        vm.startPrank(uw);
        token.approve(address(market), newFloor);
        try market.bid(id, newFloor, newRate) {
            ghost_bidCount++;
            if (prev != address(0)) {
                ghost_contestCount++;
                ghost_refundOwed += owedBefore;
                ghost_refundPaid += token.balanceOf(prev) - prevBalBefore;
            }
            FirmBidMarket.Slot memory after_ = market.slots(id);
            // The bar is the floor as it stood one instant ago, already ticked.
            if (after_.floor < curFloor) ghost_nonImprovingBids++;
            if (prev != address(0) && after_.premiumRate > curRate) ghost_nonImprovingBids++;
            if (after_.floor > ghost_maxFloorSeen[id]) ghost_maxFloorSeen[id] = after_.floor;
            ghost_lastBidFloor[id] = after_.floor;
            ghost_decayEnabled[id] = after_.decayRate != 0;
            ghost_minRateSeen[id] = after_.premiumRate;
        } catch {}
        vm.stopPrank();
    }

    function fundPremium(uint256 assetSeed, uint256 amtSeed) external {
        uint256 id = _asset(assetSeed);
        uint256 amt = bound(amtSeed, 1, 10_000e18);
        FirmBidMarket.Slot memory s = market.slots(id);
        if (!s.open) return;

        address payer = address(uint160(uint256(keccak256(abi.encode(amtSeed)))));
        token.mint(payer, amt);
        vm.startPrank(payer);
        token.approve(address(market), amt);
        try market.fundPremium(id, amt) {} catch {}
        vm.stopPrank();
    }

    function claimPremium(uint256 assetSeed) external {
        uint256 id = _asset(assetSeed);
        address uw = market.slots(id).underwriter;
        if (uw == address(0)) return;
        vm.prank(uw);
        try market.claimPremium(id) {} catch {}
    }

    function withdrawBid(uint256 assetSeed) external {
        // Rare on purpose. Withdrawal always succeeds when no debt is open, so
        // an unthrottled version vacates every slot before a second underwriter
        // can contest it - and the contest path is the mechanism under test.
        if (assetSeed % 6 != 0) return;
        uint256 id = _asset(assetSeed);
        address uw = market.slots(id).underwriter;
        if (uw == address(0)) return;
        vm.prank(uw);
        try market.withdrawBid(id) {
            // slot vacated: a fresh bid is not bound by the old slot's history
            ghost_maxFloorSeen[id] = 0;
            ghost_lastBidFloor[id] = 0;
            ghost_decayEnabled[id] = false;
            ghost_minRateSeen[id] = 0;
        } catch {}
    }

    function setDebt(uint256 assetSeed, uint256 debtSeed) external {
        uint256 id = _asset(assetSeed);
        FirmBidMarket.Slot memory s = market.slots(id);
        // never exceed the floor: origination enforces this, so the fuzzer
        // should not manufacture states the protocol cannot reach
        uint256 cap = s.floor * 8_000 / 10_000;
        vault.setDebt(id, cap == 0 ? 0 : bound(debtSeed, 0, cap));
    }

    function tick(uint256 assetSeed) external {
        market.tick(_asset(assetSeed));
    }

    function warp(uint256 blocksSeed) external {
        uint256 n = bound(blocksSeed, 1, 500_000);
        vm.roll(block.number + n);
        vm.warp(block.timestamp + n);
    }
}
