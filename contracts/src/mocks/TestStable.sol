// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestStable
/// @notice Freely mintable settlement token for BOT Chain testnet only.
/// @dev Deployed only when `STABLE_TOKEN` is unset, which is never the case on
///      mainnet. Open minting is the point: anyone testing the carrier flow
///      needs balance without asking us for it.
contract TestStable is ERC20 {
    constructor() ERC20("LADING Test USD", "tUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
