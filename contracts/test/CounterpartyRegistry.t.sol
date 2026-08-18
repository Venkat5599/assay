// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {CounterpartyRegistry} from "../src/CounterpartyRegistry.sol";

contract CounterpartyRegistryTest is Test {
    CounterpartyRegistry reg;

    address registrar = makeAddr("registrar");
    address outsider = makeAddr("outsider");
    address shipper = makeAddr("shipper");

    function setUp() public {
        reg = new CounterpartyRegistry(address(this));
        reg.setRegistrar(registrar, true);
    }

    function test_registerStartsPending() public {
        vm.prank(registrar);
        reg.register(shipper, "Acme Freight Co", CounterpartyRegistry.Role.Shipper, "US", bytes32(0));

        CounterpartyRegistry.Entity memory e = reg.entityOf(shipper);
        assertEq(e.name, "Acme Freight Co");
        assertEq(uint8(e.role), uint8(CounterpartyRegistry.Role.Shipper));
        assertEq(
            uint8(e.status),
            uint8(CounterpartyRegistry.Status.Pending),
            "naming an entity must never imply it was verified"
        );
        assertTrue(reg.isKnown(shipper));
    }

    function test_onlyRegistrarCanRegister() public {
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(CounterpartyRegistry.NotRegistrar.selector, outsider)
        );
        reg.register(shipper, "Rogue Co", CounterpartyRegistry.Role.Shipper, "US", bytes32(0));
    }

    function test_cannotRegisterTwice() public {
        vm.startPrank(registrar);
        reg.register(shipper, "Acme", CounterpartyRegistry.Role.Shipper, "US", bytes32(0));
        vm.expectRevert(
            abi.encodeWithSelector(CounterpartyRegistry.AlreadyRegistered.selector, shipper)
        );
        reg.register(shipper, "Acme Renamed", CounterpartyRegistry.Role.Shipper, "US", bytes32(0));
        vm.stopPrank();
    }

    function test_rejectsEmptyName() public {
        vm.prank(registrar);
        vm.expectRevert(CounterpartyRegistry.EmptyName.selector);
        reg.register(shipper, "", CounterpartyRegistry.Role.Shipper, "US", bytes32(0));
    }

    function test_verificationIsASeparateAct() public {
        vm.startPrank(registrar);
        reg.register(shipper, "Acme", CounterpartyRegistry.Role.Shipper, "US", bytes32(0));
        reg.setStatus(shipper, CounterpartyRegistry.Status.Verified);
        vm.stopPrank();

        assertEq(uint8(reg.entityOf(shipper).status), uint8(CounterpartyRegistry.Status.Verified));
    }

    function test_restrictedIsReachable() public {
        vm.startPrank(registrar);
        reg.register(shipper, "Acme", CounterpartyRegistry.Role.Shipper, "US", bytes32(0));
        reg.setStatus(shipper, CounterpartyRegistry.Status.Restricted);
        vm.stopPrank();

        assertEq(uint8(reg.entityOf(shipper).status), uint8(CounterpartyRegistry.Status.Restricted));
    }

    function test_unknownAddressReadsEmpty() public view {
        assertFalse(reg.isKnown(outsider));
        assertEq(reg.entityOf(outsider).registeredAt, 0);
    }

    function test_enumerates() public {
        address b = makeAddr("b");
        vm.startPrank(registrar);
        reg.register(shipper, "A", CounterpartyRegistry.Role.Shipper, "US", bytes32(0));
        reg.register(b, "B", CounterpartyRegistry.Role.Carrier, "CA", keccak256("evidence"));
        vm.stopPrank();

        assertEq(reg.count(), 2);
        assertEq(reg.accounts().length, 2);
        assertEq(reg.accountAt(1), b);
        assertEq(reg.entityOf(b).evidenceHash, keccak256("evidence"));
    }
}
