// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CounterpartyRegistry
/// @notice Names the parties a receivable points at.
///
/// @dev THE ONTOLOGY
///      A receivable commits an obligor ADDRESS. That is enough to settle
///      against and nothing else - a credit desk cannot manage concentration
///      it cannot name, and "0x0000...dEaD holds 31.7% of face" is not an
///      exposure report.
///
///      This maps an address to an entity: a legal name, a role, a
///      jurisdiction, and a verification state. It is the only place in the
///      protocol where a human-readable claim about the real world is stored,
///      and it is deliberately quarantined here, away from the market and the
///      vault, so that no settlement path can ever depend on a name.
///
/// @dev VERIFICATION IS A CLAIM, NOT A PROOF
///      `Verified` means an operator with the registrar role asserted the
///      entity is who it says. That is a governance statement, not a
///      cryptographic one, and the UI must present it as such. The document
///      hash on `AssetRegistry` is the cryptographic commitment; this is the
///      social layer beside it.
contract CounterpartyRegistry is Ownable2Step {
    enum Role {
        Unknown,
        Shipper, // owes the receivable
        Carrier, // performed the freight and holds the claim
        Broker, // intermediated the load
        Insurer
    }

    enum Status {
        Unregistered,
        Pending, // recorded, not yet checked
        Verified, // a registrar asserted identity
        Restricted // may not participate
    }

    struct Entity {
        string name;
        string jurisdiction; // ISO 3166-1 alpha-2, or a free-form region
        Role role;
        Status status;
        uint64 registeredAt;
        /// @dev keccak256 of the off-chain evidence bundle, if any. Zero when
        ///      the entity was recorded on a name alone.
        bytes32 evidenceHash;
    }

    mapping(address account => Entity) private _entities;
    mapping(address registrar => bool) public isRegistrar;

    address[] private _accounts;

    error NotRegistrar(address caller);
    error EmptyName();
    error AlreadyRegistered(address account);

    event RegistrarSet(address indexed registrar, bool allowed);
    event EntityRegistered(address indexed account, string name, Role role, string jurisdiction);
    event EntityStatusChanged(address indexed account, Status status);
    event EvidenceAttached(address indexed account, bytes32 evidenceHash);

    constructor(address initialOwner) Ownable(initialOwner) {
        isRegistrar[initialOwner] = true;
        emit RegistrarSet(initialOwner, true);
    }

    modifier onlyRegistrar() {
        if (!isRegistrar[msg.sender]) revert NotRegistrar(msg.sender);
        _;
    }

    function setRegistrar(address registrar, bool allowed) external onlyOwner {
        isRegistrar[registrar] = allowed;
        emit RegistrarSet(registrar, allowed);
    }

    /// @notice Record an entity. Starts `Pending` - naming is not verifying.
    function register(
        address account,
        string calldata name,
        Role role,
        string calldata jurisdiction,
        bytes32 evidenceHash
    ) external onlyRegistrar {
        if (bytes(name).length == 0) revert EmptyName();
        if (_entities[account].registeredAt != 0) revert AlreadyRegistered(account);

        _entities[account] = Entity({
            name: name,
            jurisdiction: jurisdiction,
            role: role,
            status: Status.Pending,
            registeredAt: uint64(block.timestamp),
            evidenceHash: evidenceHash
        });
        _accounts.push(account);

        emit EntityRegistered(account, name, role, jurisdiction);
    }

    /// @notice Move an entity between states. Verification is a separate act
    ///         from registration, by design - the two must never collapse.
    function setStatus(address account, Status status) external onlyRegistrar {
        _entities[account].status = status;
        emit EntityStatusChanged(account, status);
    }

    function attachEvidence(address account, bytes32 evidenceHash) external onlyRegistrar {
        _entities[account].evidenceHash = evidenceHash;
        emit EvidenceAttached(account, evidenceHash);
    }

    // ------------------------------------------------------------- views

    function entityOf(address account) external view returns (Entity memory) {
        return _entities[account];
    }

    function isKnown(address account) external view returns (bool) {
        return _entities[account].registeredAt != 0;
    }

    function count() external view returns (uint256) {
        return _accounts.length;
    }

    function accountAt(uint256 i) external view returns (address) {
        return _accounts[i];
    }

    /// @notice Every recorded account, for a console that wants the whole book.
    /// @dev Unbounded by design: this registry is small and read off-chain.
    ///      A production deployment with thousands of counterparties should
    ///      page through `accountAt` instead.
    function accounts() external view returns (address[] memory) {
        return _accounts;
    }
}
