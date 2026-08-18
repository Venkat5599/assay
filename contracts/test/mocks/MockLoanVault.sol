// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ILoanVault} from "../../src/interfaces/ILoanVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Stand-in for LoanVault so the market can be exercised in isolation.
contract MockLoanVault is ILoanVault {
    IERC20 public immutable token;

    mapping(uint256 => uint256) public debt;
    mapping(uint256 => bool) public defaulted;
    mapping(uint256 => uint256) public absorbed;

    constructor(IERC20 t) {
        token = t;
    }

    function setDebt(uint256 id, uint256 amount) external {
        debt[id] = amount;
    }

    function setDefaulted(uint256 id, bool v) external {
        defaulted[id] = v;
    }

    function outstanding(uint256 id) external view returns (uint256) {
        return debt[id];
    }

    function isDefaulted(uint256 id) external view returns (bool) {
        return defaulted[id];
    }

    function absorbSettlement(uint256 id, uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        absorbed[id] += amount;
        debt[id] = amount >= debt[id] ? 0 : debt[id] - amount;
    }
}
