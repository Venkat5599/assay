// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ICompliance} from "../interfaces/ICompliance.sol";

/// @title AllowlistCompliance
/// @notice v1 participation gate: an explicit allowlist per role.
/// @dev Permissioned-by-default is deliberate. It keeps the v1 deployment out
///      of public-offering territory while the jurisdictional module is built.
contract AllowlistCompliance is ICompliance, Ownable2Step {
    uint8 internal constant ROLE_ASSET = 1 << 0;
    uint8 internal constant ROLE_UNDERWRITE = 1 << 1;
    uint8 internal constant ROLE_BORROW = 1 << 2;
    uint8 internal constant ROLE_LEND = 1 << 3;

    /// @notice Bitmask of granted roles per account.
    mapping(address account => uint8 roles) public roles;

    /// @notice When true, every check passes. Escape hatch for permissionless
    ///         deployment; must never be enabled without a legal review.
    bool public openAccess;

    event RolesSet(address indexed account, uint8 roles);
    event OpenAccessSet(bool enabled);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setRoles(address account, uint8 mask) external onlyOwner {
        roles[account] = mask;
        emit RolesSet(account, mask);
    }

    function setRolesBatch(address[] calldata accounts, uint8 mask) external onlyOwner {
        for (uint256 i; i < accounts.length; ++i) {
            roles[accounts[i]] = mask;
            emit RolesSet(accounts[i], mask);
        }
    }

    function setOpenAccess(bool enabled) external onlyOwner {
        openAccess = enabled;
        emit OpenAccessSet(enabled);
    }

    function _has(address a, uint8 role) internal view returns (bool) {
        return openAccess || (roles[a] & role) != 0;
    }

    function canRegisterAsset(address a) external view returns (bool) {
        return _has(a, ROLE_ASSET);
    }

    function canUnderwrite(address a) external view returns (bool) {
        return _has(a, ROLE_UNDERWRITE);
    }

    function canBorrow(address a) external view returns (bool) {
        return _has(a, ROLE_BORROW);
    }

    function canLend(address a) external view returns (bool) {
        return _has(a, ROLE_LEND);
    }
}
