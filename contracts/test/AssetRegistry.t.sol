// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {AllowlistCompliance} from "../src/compliance/AllowlistCompliance.sol";
import {ICompliance} from "../src/interfaces/ICompliance.sol";
import {Receivable} from "../src/interfaces/IAssetRegistry.sol";

/// @notice Compliance module that admits everyone. Lets a test isolate the
///         registry's own rules from the gate in front of them.
contract OpenCompliance is ICompliance {
    function canRegisterAsset(address) external pure returns (bool) {
        return true;
    }

    function canUnderwrite(address) external pure returns (bool) {
        return true;
    }

    function canBorrow(address) external pure returns (bool) {
        return true;
    }

    function canLend(address) external pure returns (bool) {
        return true;
    }
}

contract AssetRegistryTest is Test {
    uint8 internal constant ROLE_ASSET = 1 << 0;

    AssetRegistry registry;
    AllowlistCompliance compliance;

    address originator = makeAddr("originator");
    address outsider = makeAddr("outsider");
    address carrier = makeAddr("carrier");
    address shipper = makeAddr("shipper");

    function setUp() public {
        compliance = new AllowlistCompliance(address(this));
        compliance.setRoles(originator, ROLE_ASSET);
        registry = new AssetRegistry(address(this), compliance);
    }

    function _receivable(bytes32 docHash) internal view returns (Receivable memory) {
        return Receivable({
            debtor: shipper,
            faceValue: 100_000e6,
            dueDate: uint64(block.timestamp + 90 days),
            registeredAt: 0, // set by the registry, never by the caller
            docHash: docHash
        });
    }

    function _register(bytes32 docHash) internal returns (uint256 id) {
        vm.prank(originator);
        id = registry.register(carrier, _receivable(docHash));
    }

    function test_registerMintsAndRecords() public {
        uint256 id = _register(keccak256("bol-1"));

        assertEq(id, 1, "ids start at one, so zero can mean absent");
        assertEq(registry.ownerOf(id), carrier);
        assertTrue(registry.exists(id));

        Receivable memory r = registry.receivableOf(id);
        assertEq(r.debtor, shipper);
        assertEq(r.faceValue, 100_000e6);
        assertEq(r.docHash, keccak256("bol-1"));
        assertEq(r.registeredAt, uint64(block.timestamp), "registry stamps its own clock");
        assertEq(registry.idByDocHash(keccak256("bol-1")), id);
    }

    /// The duplicate-document rule is the protocol's only on-chain defence
    /// against pledging one bill of lading twice. It is asserted in the README,
    /// so it is asserted here.
    function test_rejectsDuplicateDocHash() public {
        uint256 first = _register(keccak256("bol-1"));

        vm.prank(originator);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.DuplicateDocument.selector, keccak256("bol-1"), first
            )
        );
        registry.register(carrier, _receivable(keccak256("bol-1")));
    }

    /// A second, distinct document is not a duplicate. Without this the rule
    /// above could pass by rejecting everything.
    function test_acceptsDistinctDocHash() public {
        uint256 first = _register(keccak256("bol-1"));
        uint256 second = _register(keccak256("bol-2"));
        assertEq(second, first + 1);
    }

    /// Burning is not exposed, but ownership moves on settlement. A transferred
    /// receivable must still be un-pledgeable a second time.
    function test_duplicateRejectedAfterTransfer() public {
        uint256 id = _register(keccak256("bol-1"));
        vm.prank(carrier);
        registry.transferFrom(carrier, outsider, id);

        vm.prank(originator);
        vm.expectRevert(
            abi.encodeWithSelector(AssetRegistry.DuplicateDocument.selector, keccak256("bol-1"), id)
        );
        registry.register(carrier, _receivable(keccak256("bol-1")));
    }

    function test_onlyPermittedMayRegister() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.NotPermitted.selector, outsider));
        registry.register(carrier, _receivable(keccak256("bol-1")));
    }

    function test_rejectsZeroFaceValue() public {
        Receivable memory r = _receivable(keccak256("bol-1"));
        r.faceValue = 0;

        vm.prank(originator);
        vm.expectRevert(AssetRegistry.InvalidReceivable.selector);
        registry.register(carrier, r);
    }

    function test_rejectsEmptyDocHash() public {
        vm.prank(originator);
        vm.expectRevert(AssetRegistry.InvalidReceivable.selector);
        registry.register(carrier, _receivable(bytes32(0)));
    }

    /// A receivable already past due has no financing window, and a due date in
    /// the past would make the vault's maturity trigger immediately callable.
    function test_rejectsPastDueDate() public {
        vm.warp(1_000_000);
        Receivable memory r = _receivable(keccak256("bol-1"));
        r.dueDate = uint64(block.timestamp);

        vm.prank(originator);
        vm.expectRevert(AssetRegistry.InvalidReceivable.selector);
        registry.register(carrier, r);
    }

    function test_receivableOfUnknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.UnknownAsset.selector, uint256(42)));
        registry.receivableOf(42);
    }

    function test_existsIsFalseForUnknown() public view {
        assertFalse(registry.exists(42));
    }

    function test_ownerOfUnknownReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(42))
        );
        registry.ownerOf(42);
    }

    function test_setComplianceSwapsTheGate() public {
        OpenCompliance open = new OpenCompliance();
        registry.setCompliance(open);
        assertEq(address(registry.compliance()), address(open));

        // The outsider was rejected under the allowlist; the swap is what
        // changes, not the caller.
        vm.prank(outsider);
        registry.register(carrier, _receivable(keccak256("bol-1")));
    }

    function test_onlyOwnerMaySetCompliance() public {
        OpenCompliance open = new OpenCompliance();
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider)
        );
        registry.setCompliance(open);
    }

    /// Ids must never be reused, whatever the sequence of documents.
    function testFuzz_idsAreUniqueAndMonotonic(bytes32 a, bytes32 b) public {
        vm.assume(a != bytes32(0) && b != bytes32(0) && a != b);
        uint256 first = _register(a);
        uint256 second = _register(b);
        assertEq(second, first + 1);
        assertEq(registry.idByDocHash(a), first);
        assertEq(registry.idByDocHash(b), second);
    }
}
