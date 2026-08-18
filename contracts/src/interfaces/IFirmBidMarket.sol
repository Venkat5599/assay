// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @notice The subset of the market the vault depends on.
/// @dev Kept minimal and one-directional on purpose. The vault reads headroom
///      from the market; the market reads debt from the vault. Narrowing each
///      side to a single view keeps that cycle terminating and auditable.
interface IFirmBidMarket {
    /// @notice Maximum principal borrowable against the current (decayed) floor.
    function maxBorrow(uint256 assetId) external view returns (uint256);

    /// @notice Current firm bid price, after decay, clamped at outstanding debt.
    function currentFloor(uint256 assetId) external view returns (uint256);

    /// @notice Depositor of the escrowed collateral, or zero if no open slot.
    function slotOwner(uint256 assetId) external view returns (address);
}
