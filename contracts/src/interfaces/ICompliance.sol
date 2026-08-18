// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title ICompliance
/// @notice Pluggable participation gate. Swapping the implementation is how
///         PLINTH adapts to a jurisdiction without touching market logic.
/// @dev A null implementation returning `true` everywhere makes the protocol
///      permissionless. v1 ships an allowlist.
interface ICompliance {
    function canRegisterAsset(address account) external view returns (bool);
    function canUnderwrite(address account) external view returns (bool);
    function canBorrow(address account) external view returns (bool);
    function canLend(address account) external view returns (bool);
}
