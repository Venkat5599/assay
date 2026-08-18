// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @notice A commercial trade receivable recorded on-chain.
/// @dev `docHash` commits to the off-chain document bundle (invoice, bill of
///      lading, assignment notice). PLINTH never asserts the document is
///      genuine - the underwriter's escrowed capital is what prices that risk.
struct Receivable {
    address debtor;      // obligor on the receivable (informational)
    uint128 faceValue;   // denominated in the escrow token
    uint64  dueDate;     // unix seconds
    uint64  registeredAt;
    bytes32 docHash;     // keccak256 of the canonical document bundle
}

interface IAssetRegistry {
    function register(address to, Receivable calldata data) external returns (uint256 id);
    function receivableOf(uint256 id) external view returns (Receivable memory);
    function exists(uint256 id) external view returns (bool);
    function ownerOf(uint256 id) external view returns (address);
    function transferFrom(address from, address to, uint256 id) external;
}
