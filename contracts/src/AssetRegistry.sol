// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ICompliance} from "./interfaces/ICompliance.sol";
import {IAssetRegistry, Receivable} from "./interfaces/IAssetRegistry.sol";

/// @title AssetRegistry
/// @notice ERC-721 record of commercial trade receivables used as PLINTH collateral.
/// @dev The registry is intentionally dumb. It asserts nothing about whether a
///      receivable is genuine; that judgement is priced by underwriters who
///      escrow real capital against it. `docHash` is a commitment, not a proof.
///
///      Uniqueness note: `docHash` is enforced unique to make double-pledging
///      the same document detectable at registration time. This is a cheap
///      first line of defence, not a substitute for underwriter diligence.
contract AssetRegistry is IAssetRegistry, ERC721, Ownable2Step {
    ICompliance public compliance;

    uint256 private _nextId = 1;

    mapping(uint256 id => Receivable) private _receivables;
    mapping(bytes32 docHash => uint256 id) public idByDocHash;

    error NotPermitted(address account);
    error DuplicateDocument(bytes32 docHash, uint256 existingId);
    error InvalidReceivable();
    error UnknownAsset(uint256 id);

    event Registered(
        uint256 indexed id, address indexed owner, bytes32 indexed docHash, uint128 faceValue
    );
    event ComplianceUpdated(address indexed compliance);

    constructor(address initialOwner, ICompliance compliance_)
        ERC721("PLINTH Receivable", "pRCV")
        Ownable(initialOwner)
    {
        compliance = compliance_;
    }

    function setCompliance(ICompliance compliance_) external onlyOwner {
        compliance = compliance_;
        emit ComplianceUpdated(address(compliance_));
    }

    /// @notice Record a receivable and mint its ownership token.
    /// @dev Reverts if the document hash has already been registered.
    function register(address to, Receivable calldata data) external returns (uint256 id) {
        if (!compliance.canRegisterAsset(msg.sender)) revert NotPermitted(msg.sender);
        if (data.faceValue == 0 || data.docHash == bytes32(0)) revert InvalidReceivable();
        if (data.dueDate <= block.timestamp) revert InvalidReceivable();

        uint256 existing = idByDocHash[data.docHash];
        if (existing != 0) revert DuplicateDocument(data.docHash, existing);

        id = _nextId++;
        _receivables[id] = Receivable({
            debtor: data.debtor,
            faceValue: data.faceValue,
            dueDate: data.dueDate,
            registeredAt: uint64(block.timestamp),
            docHash: data.docHash
        });
        idByDocHash[data.docHash] = id;

        _safeMint(to, id);
        emit Registered(id, to, data.docHash, data.faceValue);
    }

    function receivableOf(uint256 id) external view returns (Receivable memory r) {
        r = _receivables[id];
        if (r.faceValue == 0) revert UnknownAsset(id);
    }

    function exists(uint256 id) external view returns (bool) {
        return _ownerOf(id) != address(0);
    }

    function ownerOf(uint256 id) public view override(ERC721, IAssetRegistry) returns (address) {
        return ERC721.ownerOf(id);
    }

    function transferFrom(address from, address to, uint256 id)
        public
        override(ERC721, IAssetRegistry)
    {
        ERC721.transferFrom(from, to, id);
    }
}
