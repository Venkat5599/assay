// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {CounterpartyRegistry} from "../src/CounterpartyRegistry.sol";
import {FirmBidMarket} from "../src/FirmBidMarket.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {Receivable} from "../src/interfaces/IAssetRegistry.sol";

/// @notice Puts one receivable through origination on mainnet.
///
/// @dev DIFFERENT FROM `Seed.s.sol`, AND IT HAS TO BE.
///      The testnet seed mints its own settlement token and counts in
///      eighteen decimals. Neither is true here. LADING settles in bridged
///      USDT - an asset it does not issue, at SIX decimals - so this script
///      cannot conjure balance and must read precision from the token rather
///      than assume it. Run the testnet script against mainnet and every
///      figure is off by twelve orders of magnitude.
///
///      It also stops short of bidding. On testnet the seed placed two bids
///      itself to make the contest visible; here the underwriters are the
///      agents, and a deployer bidding against itself to decorate the book is
///      the exact fiction this protocol exists to avoid. The slot opens, and
///      it stays unpriced until somebody with capital forms an opinion.
///
///      Run:
///        export ASSET_REGISTRY=... FIRM_BID_MARKET=... LOAN_VAULT=...
///        export STABLE_TOKEN=... COUNTERPARTY_REGISTRY=...
///        export OBLIGOR=0x...            # who owes the invoice
///        export OBLIGOR_NAME="..."       # the legal entity behind it
///        export FACE=18400               # whole USDT
///        export PREMIUM=400              # whole USDT
///        export POOL=5000                # whole USDT, lender side
///        export DOC_REF="..."            # the string the document hashes from
///        forge script script/SeedMainnet.s.sol:SeedMainnet \
///          --rpc-url $BOTCHAIN_RPC_URL --broadcast
contract SeedMainnet is Script {
    /// @dev Grouped into a struct because the flat version overflowed the
    ///      stack. Solidity's sixteen-slot limit is a real constraint on
    ///      scripts that read a lot of configuration.
    struct Config {
        AssetRegistry registry;
        FirmBidMarket market;
        LoanVault vault;
        IERC20 stable;
        address obligor;
        string docRef;
        uint256 face;
        uint256 premium;
        uint256 pool;
        uint64 termDays;
    }

    function _config() internal view returns (Config memory c) {
        c.registry = AssetRegistry(vm.envAddress("ASSET_REGISTRY"));
        c.market = FirmBidMarket(vm.envAddress("FIRM_BID_MARKET"));
        c.vault = LoanVault(vm.envAddress("LOAN_VAULT"));
        c.stable = IERC20(vm.envAddress("STABLE_TOKEN"));
        c.obligor = vm.envAddress("OBLIGOR");
        c.docRef = vm.envString("DOC_REF");

        // Precision is read, never assumed. This is the single most likely
        // place for a decimals bug to enter, and it would not revert - it would
        // quietly register a receivable a million times the intended size.
        uint256 unit = 10 ** IERC20Metadata(address(c.stable)).decimals();
        c.face = vm.envOr("FACE", uint256(18_400)) * unit;
        c.premium = vm.envOr("PREMIUM", uint256(400)) * unit;
        c.pool = vm.envOr("POOL", uint256(5_000)) * unit;
        c.termDays = uint64(vm.envOr("TERM_DAYS", uint256(90)));
    }

    /// @dev Name the obligor before pledging anything against it. A credit desk
    ///      cannot manage concentration it cannot name, and the ontology is
    ///      deliberately separate from the market, so adding a name never
    ///      touches capital that is already escrowed.
    function _name(Config memory c) internal {
        address ontology = vm.envOr("COUNTERPARTY_REGISTRY", address(0));
        if (ontology == address(0)) return;

        CounterpartyRegistry reg = CounterpartyRegistry(ontology);
        if (reg.isKnown(c.obligor)) return;

        reg.register(
            c.obligor,
            vm.envOr("OBLIGOR_NAME", string("Unnamed obligor")),
            CounterpartyRegistry.Role.Shipper,
            vm.envOr("OBLIGOR_JURISDICTION", string("US")),
            keccak256(bytes(c.docRef))
        );
        // Registered, not verified. The two are separate acts on purpose:
        // naming an entity is not the same as having checked it.
        console2.log("counterparty recorded as Pending");
    }

    function run() external {
        Config memory c = _config();

        uint256 held = c.stable.balanceOf(msg.sender);
        console2.log("balance held", held);
        console2.log("needed      ", c.premium + c.pool);
        require(
            held >= c.premium + c.pool, "insufficient settlement balance: bridge or buy USDT first"
        );

        vm.startBroadcast();

        _name(c);

        c.stable.approve(address(c.market), c.premium);
        c.stable.approve(address(c.vault), c.pool);

        uint256 assetId = c.registry
            .register(
                msg.sender,
                Receivable({
                    debtor: c.obligor,
                    faceValue: uint128(c.face),
                    dueDate: uint64(block.timestamp) + c.termDays * 1 days,
                    registeredAt: 0,
                    docHash: keccak256(bytes(c.docRef))
                })
            );

        c.registry.setApprovalForAll(address(c.market), true);
        c.market.openSlot(assetId, c.premium);
        if (c.pool > 0) c.vault.deposit(c.pool);

        vm.stopBroadcast();

        console2.log("assetId      ", assetId);
        console2.log("face         ", c.face);
        console2.log("currentFloor ", c.market.currentFloor(assetId));
        console2.log("maxBorrow    ", c.market.maxBorrow(assetId));
        console2.log("");
        console2.log("Slot is open and UNPRICED. Start the agents to see it contested:");
        console2.log("  cd agent && bun run fund:send && bun run start");
    }
}
