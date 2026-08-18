// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CounterpartyRegistry} from "../src/CounterpartyRegistry.sol";

/// @notice Deploys the counterparty ontology alongside a live protocol.
/// @dev Standalone by design. Nothing in the market, the vault or the asset
///      registry references it, so adding names to a running deployment never
///      requires migrating capital that is already escrowed.
contract DeployOntology is Script {
    function run() external {
        vm.startBroadcast();
        CounterpartyRegistry reg = new CounterpartyRegistry(msg.sender);
        vm.stopBroadcast();
        console2.log("CounterpartyRegistry", address(reg));
    }
}
