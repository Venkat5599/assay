// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {AllowlistCompliance} from "../src/compliance/AllowlistCompliance.sol";

contract AllowlistComplianceTest is Test {
    uint8 internal constant ROLE_ASSET = 1 << 0;
    uint8 internal constant ROLE_UNDERWRITE = 1 << 1;
    uint8 internal constant ROLE_BORROW = 1 << 2;
    uint8 internal constant ROLE_LEND = 1 << 3;

    AllowlistCompliance gate;

    address owner = makeAddr("owner");
    address originator = makeAddr("originator");
    address underwriter = makeAddr("underwriter");
    address outsider = makeAddr("outsider");

    event RolesSet(address indexed account, uint8 roles);
    event OpenAccessSet(bool enabled);

    function setUp() public {
        gate = new AllowlistCompliance(owner);
    }

    /// Permissioned by default is the whole point of the v1 module. An empty
    /// allowlist that admitted anyone would be a silent public offering.
    function test_deniesEveryoneByDefault() public view {
        assertFalse(gate.canRegisterAsset(outsider));
        assertFalse(gate.canUnderwrite(outsider));
        assertFalse(gate.canBorrow(outsider));
        assertFalse(gate.canLend(outsider));
        assertFalse(gate.openAccess());
    }

    function test_rolesAreIndependent() public {
        vm.prank(owner);
        gate.setRoles(originator, ROLE_ASSET);

        assertTrue(gate.canRegisterAsset(originator));
        assertFalse(gate.canUnderwrite(originator), "one grant must not imply another");
        assertFalse(gate.canBorrow(originator));
        assertFalse(gate.canLend(originator));
    }

    function test_maskGrantsSeveralRolesAtOnce() public {
        vm.prank(owner);
        gate.setRoles(underwriter, ROLE_UNDERWRITE | ROLE_LEND);

        assertTrue(gate.canUnderwrite(underwriter));
        assertTrue(gate.canLend(underwriter));
        assertFalse(gate.canRegisterAsset(underwriter));
        assertFalse(gate.canBorrow(underwriter));
    }

    /// Revocation has to be reachable, or a compromised participant can only be
    /// contained by replacing the whole module.
    function test_rolesCanBeRevoked() public {
        vm.startPrank(owner);
        gate.setRoles(originator, ROLE_ASSET);
        assertTrue(gate.canRegisterAsset(originator));
        gate.setRoles(originator, 0);
        vm.stopPrank();

        assertFalse(gate.canRegisterAsset(originator));
        assertEq(gate.roles(originator), 0);
    }

    function test_setRolesEmits() public {
        vm.expectEmit(true, false, false, true);
        emit RolesSet(originator, ROLE_ASSET);
        vm.prank(owner);
        gate.setRoles(originator, ROLE_ASSET);
    }

    function test_batchGrantsToEveryAccount() public {
        address[] memory accounts = new address[](3);
        accounts[0] = originator;
        accounts[1] = underwriter;
        accounts[2] = outsider;

        vm.prank(owner);
        gate.setRolesBatch(accounts, ROLE_BORROW);

        for (uint256 i; i < accounts.length; ++i) {
            assertTrue(gate.canBorrow(accounts[i]));
        }
    }

    function test_batchAcceptsEmptyList() public {
        address[] memory none = new address[](0);
        vm.prank(owner);
        gate.setRolesBatch(none, ROLE_BORROW);
    }

    /// The escape hatch works, and the test says out loud what enabling it does.
    function test_openAccessAdmitsEveryone() public {
        vm.prank(owner);
        gate.setOpenAccess(true);

        assertTrue(gate.canRegisterAsset(outsider));
        assertTrue(gate.canUnderwrite(outsider));
        assertTrue(gate.canBorrow(outsider));
        assertTrue(gate.canLend(outsider));
    }

    function test_openAccessIsReversible() public {
        vm.startPrank(owner);
        gate.setOpenAccess(true);
        gate.setOpenAccess(false);
        vm.stopPrank();

        assertFalse(gate.canBorrow(outsider));
    }

    function test_openAccessEmits() public {
        vm.expectEmit(false, false, false, true);
        emit OpenAccessSet(true);
        vm.prank(owner);
        gate.setOpenAccess(true);
    }

    function test_onlyOwnerMaySetRoles() public {
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider)
        );
        gate.setRoles(outsider, ROLE_UNDERWRITE);
    }

    function test_onlyOwnerMaySetRolesBatch() public {
        address[] memory accounts = new address[](1);
        accounts[0] = outsider;

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider)
        );
        gate.setRolesBatch(accounts, ROLE_UNDERWRITE);
    }

    /// Opening the gate is the single most consequential call on this contract.
    function test_onlyOwnerMaySetOpenAccess() public {
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider)
        );
        gate.setOpenAccess(true);
    }

    /// Ownership is two-step, so a mistyped address cannot strand the gate.
    function test_ownershipTransferRequiresAcceptance() public {
        address next = makeAddr("next");

        vm.prank(owner);
        gate.transferOwnership(next);
        assertEq(gate.owner(), owner, "pending, not transferred");
        assertEq(gate.pendingOwner(), next);

        vm.prank(next);
        gate.acceptOwnership();
        assertEq(gate.owner(), next);
    }

    /// Whatever mask is set, every predicate must answer from its own bit.
    function testFuzz_predicatesMatchTheirBit(uint8 mask) public {
        vm.prank(owner);
        gate.setRoles(originator, mask);

        assertEq(gate.canRegisterAsset(originator), mask & ROLE_ASSET != 0);
        assertEq(gate.canUnderwrite(originator), mask & ROLE_UNDERWRITE != 0);
        assertEq(gate.canBorrow(originator), mask & ROLE_BORROW != 0);
        assertEq(gate.canLend(originator), mask & ROLE_LEND != 0);
    }

    /// Open access overrides every mask, including an empty one.
    function testFuzz_openAccessOverridesAnyMask(uint8 mask) public {
        vm.startPrank(owner);
        gate.setRoles(originator, mask);
        gate.setOpenAccess(true);
        vm.stopPrank();

        assertTrue(gate.canRegisterAsset(originator));
        assertTrue(gate.canUnderwrite(originator));
        assertTrue(gate.canBorrow(originator));
        assertTrue(gate.canLend(originator));
    }
}
