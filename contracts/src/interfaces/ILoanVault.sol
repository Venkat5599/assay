// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

interface ILoanVault {
    /// @notice Debt currently owed against `assetId`, in escrow-token units.
    /// @dev Returns 0 when no loan is open. The market treats an unset vault
    ///      as "no debt anywhere", which lets the market be tested in isolation.
    function outstanding(uint256 assetId) external view returns (uint256);

    /// @notice True when the borrower has breached and the slot may be settled.
    function isDefaulted(uint256 assetId) external view returns (bool);

    /// @notice Called by the market during settlement with the escrow proceeds.
    function absorbSettlement(uint256 assetId, uint256 amount) external;
}
