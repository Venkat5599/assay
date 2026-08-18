// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title RayMath
/// @notice Fixed-point math in RAY (1e27) precision.
/// @dev Convention matches Aave/Maker. All rounding is explicit and documented
///      at each call site; the default here is round-half-up for `rmul` and
///      round-down for `rpow` (compounding decay must never over-credit).
library RayMath {
    uint256 internal constant RAY = 1e27;
    uint256 internal constant HALF_RAY = 0.5e27;

    error RayMath_Overflow();

    /// @notice Multiply two RAY numbers, rounding half up.
    function rmul(uint256 a, uint256 b) internal pure returns (uint256 c) {
        if (a == 0 || b == 0) return 0;
        // overflow guard: a * b + HALF_RAY must not wrap
        if (a > (type(uint256).max - HALF_RAY) / b) revert RayMath_Overflow();
        unchecked {
            c = (a * b + HALF_RAY) / RAY;
        }
    }

    /// @notice Multiply two RAY numbers, rounding down.
    /// @dev Used where rounding must favour the protocol over the caller.
    function rmulDown(uint256 a, uint256 b) internal pure returns (uint256 c) {
        if (a == 0 || b == 0) return 0;
        if (a > type(uint256).max / b) revert RayMath_Overflow();
        unchecked {
            c = (a * b) / RAY;
        }
    }

    /// @notice Divide two RAY numbers, rounding half up.
    function rdiv(uint256 a, uint256 b) internal pure returns (uint256 c) {
        if (b == 0) revert RayMath_Overflow();
        if (a == 0) return 0;
        if (a > (type(uint256).max - b / 2) / RAY) revert RayMath_Overflow();
        unchecked {
            c = (a * RAY + b / 2) / b;
        }
    }

    /// @notice `x` raised to the power `n`, in RAY, by binary exponentiation.
    /// @dev Rounds down at every step. Used for per-block compounding decay,
    ///      where under-crediting the floor is the safe direction: a lower
    ///      floor can only tighten LTV, never loosen it.
    ///      Gas is O(log n), so an arbitrarily long gap between ticks costs
    ///      the same order as a short one.
    function rpow(uint256 x, uint256 n) internal pure returns (uint256 z) {
        z = n % 2 != 0 ? x : RAY;
        for (n /= 2; n != 0; n /= 2) {
            x = rmulDown(x, x);
            if (n % 2 != 0) {
                z = rmulDown(z, x);
            }
        }
    }
}
