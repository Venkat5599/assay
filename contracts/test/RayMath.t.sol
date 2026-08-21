// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {RayMath} from "../src/libraries/RayMath.sol";

/// @dev A library cannot be pranked or reverted-into directly, so the harness
///      gives every function an external frame for `vm.expectRevert`.
contract RayMathHarness {
    function rmul(uint256 a, uint256 b) external pure returns (uint256) {
        return RayMath.rmul(a, b);
    }

    function rmulDown(uint256 a, uint256 b) external pure returns (uint256) {
        return RayMath.rmulDown(a, b);
    }

    function rdiv(uint256 a, uint256 b) external pure returns (uint256) {
        return RayMath.rdiv(a, b);
    }

    function rpow(uint256 x, uint256 n) external pure returns (uint256) {
        return RayMath.rpow(x, n);
    }
}

contract RayMathTest is Test {
    uint256 internal constant RAY = 1e27;
    uint256 internal constant HALF_RAY = 0.5e27;

    RayMathHarness h;

    function setUp() public {
        h = new RayMathHarness();
    }

    // --- identities -------------------------------------------------------

    function test_rmulByOneIsIdentity() public view {
        assertEq(h.rmul(123e27, RAY), 123e27);
        assertEq(h.rmulDown(123e27, RAY), 123e27);
    }

    function test_rdivByOneIsIdentity() public view {
        assertEq(h.rdiv(123e27, RAY), 123e27);
    }

    function test_zeroShortCircuits() public view {
        assertEq(h.rmul(0, RAY), 0);
        assertEq(h.rmul(RAY, 0), 0);
        assertEq(h.rmulDown(0, RAY), 0);
        assertEq(h.rmulDown(RAY, 0), 0);
        assertEq(h.rdiv(0, RAY), 0);
    }

    // --- rounding ---------------------------------------------------------

    /// The two multiplies differ only in rounding, and that difference decides
    /// who absorbs the last wei. Pin it with a value that lands exactly on the
    /// half: 1 wei x half a RAY = 0.5, which rounds up to 1 and down to 0.
    function test_rmulRoundsHalfUpAndRmulDownTruncates() public view {
        assertEq(h.rmul(1, HALF_RAY), 1, "half up");
        assertEq(h.rmulDown(1, HALF_RAY), 0, "down");
    }

    function test_rdivRoundsHalfUp() public view {
        // 1 / 2 = 0.5 RAY exactly; half-up keeps the wei.
        assertEq(h.rdiv(1, 2 * RAY), 1);
        // 1 / 3 = 0.333... , below the half, so it truncates.
        assertEq(h.rdiv(1, 3 * RAY), 0);
    }

    /// rmul never lands below rmulDown, and the gap is at most one wei.
    function testFuzz_rmulNeverBelowRmulDown(uint128 a, uint128 b) public view {
        uint256 up = h.rmul(a, b);
        uint256 down = h.rmulDown(a, b);
        assertGe(up, down);
        assertLe(up - down, 1);
    }

    // --- rpow -------------------------------------------------------------

    function test_rpowZeroExponentIsOne() public view {
        assertEq(h.rpow(2 * RAY, 0), RAY, "x^0 is one, whatever x is");
        assertEq(h.rpow(0, 0), RAY);
    }

    function test_rpowOneExponentIsBase() public view {
        assertEq(h.rpow(2 * RAY, 1), 2 * RAY);
    }

    function test_rpowMatchesRepeatedMultiplication() public view {
        uint256 x = RAY - 1e18; // a rate just under one, as decay uses
        uint256 expected = RAY;
        for (uint256 i; i < 12; ++i) {
            expected = RayMath.rmulDown(expected, x);
        }
        assertEq(h.rpow(x, 12), expected);
    }

    /// Decay compounds a factor below one. It must stay below one and must
    /// never round its way back up, or a floor could recover on its own.
    function test_rpowBelowOneIsMonotonicallyDecreasing() public view {
        uint256 x = RAY - 1e20;
        uint256 prev = type(uint256).max;
        for (uint256 n = 1; n <= 64; ++n) {
            uint256 z = h.rpow(x, n);
            assertLt(z, RAY, "a factor under one can never compound above one");
            assertLe(z, prev, "and never increases with the exponent");
            prev = z;
        }
    }

    /// Rounding down at every step is the safe direction for a floor: it may
    /// under-credit, never over-credit.
    function testFuzz_rpowNeverExceedsRayForFactorBelowRay(uint256 x, uint8 n) public view {
        x = bound(x, 0, RAY);
        assertLe(h.rpow(x, n == 0 ? 1 : n), RAY);
    }

    // --- overflow guards --------------------------------------------------

    function test_rmulOverflowReverts() public {
        vm.expectRevert(RayMath.RayMath_Overflow.selector);
        h.rmul(type(uint256).max, 2 * RAY);
    }

    function test_rmulDownOverflowReverts() public {
        vm.expectRevert(RayMath.RayMath_Overflow.selector);
        h.rmulDown(type(uint256).max, 2 * RAY);
    }

    function test_rdivByZeroReverts() public {
        vm.expectRevert(RayMath.RayMath_Overflow.selector);
        h.rdiv(RAY, 0);
    }

    function test_rdivOverflowReverts() public {
        vm.expectRevert(RayMath.RayMath_Overflow.selector);
        h.rdiv(type(uint256).max, 1);
    }

    /// The guard must not be so eager that ordinary protocol-sized numbers trip
    /// it. A face value in the billions at 18 decimals is still fine.
    function test_realisticMagnitudesDoNotRevert() public view {
        assertGt(h.rmul(1e9 * 1e18, RAY + 1e25), 0);
        assertGt(h.rdiv(1e9 * 1e18, RAY / 2), 0);
    }

    // --- round trip -------------------------------------------------------

    /// Multiply then divide by the same factor returns the input, give or take
    /// the rounding each step is allowed. The factor is held near unity: a
    /// factor orders of magnitude below a RAY truncates the product to nothing,
    /// and losing the value there is arithmetic working, not a round trip.
    function testFuzz_mulDivRoundTrip(uint96 a, uint256 factor) public view {
        factor = bound(factor, RAY / 2, 2 * RAY);
        uint256 product = h.rmul(a, factor);
        uint256 back = h.rdiv(product, factor);
        assertApproxEqAbs(back, a, 2);
    }
}
