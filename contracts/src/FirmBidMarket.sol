// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {RayMath} from "./libraries/RayMath.sol";
import {ICompliance} from "./interfaces/ICompliance.sol";
import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {ILoanVault} from "./interfaces/ILoanVault.sol";

/// @title FirmBidMarket
/// @notice A contestable market for firm purchase bids on real-world collateral.
///
/// @dev THE MECHANISM
///      An underwriter posts a *firm bid*: a commitment to buy the asset at
///      price `floor`, with `floor` escrowed in full up front. They are not
///      insuring a loss - on default they receive the asset. That distinction
///      is deliberate and load-bearing: a purchase commitment is commerce, a
///      loss indemnity would be financial guaranty insurance.
///
///      The bid slot is permanently contestable. Any underwriter may displace
///      the incumbent by offering strictly better terms - a higher floor, or
///      the same floor at a lower premium. The displaced party is refunded
///      their escrow plus all accrued premium, in full, atomically.
///
///      Two consequences fall out, and they are the point of the design:
///
///      1. PRICE DISCOVERY WITHOUT A MARKET. Competition to buy produces a
///         live, capital-backed valuation for an asset that has no orderbook.
///
///      2. GOVERNANCE-FREE RISK. An uncontested floor decays every block. As
///         it falls, headroom against the outstanding loan compresses until
///         the loan becomes callable. Risk parameters therefore update
///         continuously, without a vote.
///
/// @dev NO ORACLE. This contract reads no external price feed, by construction.
///      Every number that matters originates from capital somebody escrowed.
contract FirmBidMarket is ReentrancyGuardTransient, Ownable2Step {
    using SafeERC20 for IERC20;
    using RayMath for uint256;

    uint256 private constant RAY = 1e27;
    uint256 private constant BPS = 10_000;

    // ---------------------------------------------------------------- types

    struct Slot {
        address owner; // asset depositor; reclaims collateral on close
        address underwriter;
        uint64 lastTick; // block number of last accrual
        bool open; // slot accepts bids
        uint256 floor; // F - current firm bid price
        uint256 escrow; // pre-funded; INV-1: escrow >= floor
        uint256 accrued; // premium earned, withdrawable by underwriter
        uint256 premiumReserve; // borrower-funded; streams into `accrued`
        uint128 premiumRate; // per-block fraction of floor, RAY
        uint128 decayRate; // per-block floor decay, RAY
    }

    // ---------------------------------------------------------------- state

    IERC20 public immutable escrowToken;
    IAssetRegistry public immutable assetRegistry;

    ICompliance public compliance;
    ILoanVault public loanVault;

    /// @notice Minimum relative improvement required to displace an incumbent.
    /// @dev Anti-griefing. Without it, an attacker can churn the slot with
    ///      dust improvements and reset the incumbent's position for free.
    uint256 public minImprovementBps = 25; // 0.25%

    /// @notice Haircut applied to the floor when deriving max borrow.
    uint256 public haircutBps = 2_000; // 20%

    /// @notice Upper bound on per-block decay, guarding against a misconfigured
    ///         rate wiping a floor out inside a few blocks.
    /// @dev 1e-6 per block. On a 0.75s chain that is ~11% a day, which is fast
    ///      enough to be a real ceiling and slow enough that no setting of it
    ///      can erase a floor before anybody can react.
    uint128 public maxDecayRate = 1e21;

    /// @notice Per-block decay applied to a standing floor, RAY.
    ///
    /// @dev THE POINT OF THIS NUMBER.
    ///      A firm bid is a live opinion, and an opinion nobody has restated is
    ///      worth less than a fresh one. Decay makes a standing bid go stale by
    ///      itself: the floor falls every block, headroom against the loan
    ///      compresses, and a position nobody is willing to keep backing becomes
    ///      callable on its own - no vote, no keeper choosing the moment.
    ///
    ///      Decay only ever bites an UNCONTESTED slot. A contest writes a fresh
    ///      floor and a fresh `lastTick`, so restating the bid resets it.
    ///
    ///      It is a protocol parameter rather than a bid parameter on purpose.
    ///      Decay is worth money to the underwriter (they settle at the decayed
    ///      floor) and costs the borrower headroom, so neither side can be
    ///      trusted to choose it. Nobody at the table sets it.
    ///
    ///      Default 2.15e-8/block: on a 0.75s chain, ~20% erosion across a
    ///      90-day receivable if the bid is never restated.
    uint128 public decayRatePerBlock = 21_500_000_000_000_000_000;

    mapping(uint256 assetId => Slot) internal _slots;

    /// @notice Sum of all escrow + accrued + premiumReserve the contract owes.
    /// @dev Tracked explicitly so INV-2 is checkable in O(1) rather than by
    ///      iterating every slot.
    uint256 public totalLiabilities;

    // --------------------------------------------------------------- errors

    error NotPermitted(address account);
    error NotAssetOwner(uint256 assetId, address caller);
    error SlotNotOpen(uint256 assetId);
    error SlotAlreadyOpen(uint256 assetId);
    error NoIncumbent(uint256 assetId);
    error NotIncumbent(uint256 assetId, address caller);
    error BidNotBetter(uint256 newFloor, uint256 newRate, uint256 curFloor, uint256 curRate);
    error BelowOutstandingDebt(uint256 floor, uint256 outstanding);
    error DebtOutstanding(uint256 assetId, uint256 outstanding);
    error NotDefaulted(uint256 assetId);
    error ZeroAmount();
    error DecayTooHigh(uint128 rate, uint128 max);
    error VaultUnset();

    // --------------------------------------------------------------- events

    event SlotOpened(uint256 indexed assetId, address indexed owner, uint256 premiumReserve);
    event SlotClosed(uint256 indexed assetId);
    event BidPlaced(
        uint256 indexed assetId,
        address indexed underwriter,
        address indexed displaced,
        uint256 floor,
        uint256 premiumRate
    );
    event BidWithdrawn(uint256 indexed assetId, address indexed underwriter, uint256 refund);
    event Ticked(uint256 indexed assetId, uint256 floor, uint256 accrued, uint256 premiumReserve);
    event PremiumClaimed(uint256 indexed assetId, address indexed underwriter, uint256 amount);
    event PremiumFunded(uint256 indexed assetId, address indexed payer, uint256 amount);
    event Settled(
        uint256 indexed assetId, address indexed underwriter, uint256 price, uint256 refund
    );
    event ParametersUpdated(uint256 minImprovementBps, uint256 haircutBps, uint128 maxDecayRate);
    event DecayRateUpdated(uint128 decayRatePerBlock);

    // ---------------------------------------------------------- construction

    constructor(
        address initialOwner,
        IERC20 escrowToken_,
        IAssetRegistry assetRegistry_,
        ICompliance compliance_
    ) Ownable(initialOwner) {
        escrowToken = escrowToken_;
        assetRegistry = assetRegistry_;
        compliance = compliance_;
    }

    // ------------------------------------------------------------ admin

    function setCompliance(ICompliance c) external onlyOwner {
        compliance = c;
    }

    function setLoanVault(ILoanVault v) external onlyOwner {
        loanVault = v;
    }

    function setParameters(uint256 minImprovementBps_, uint256 haircutBps_, uint128 maxDecayRate_)
        external
        onlyOwner
    {
        require(haircutBps_ < BPS, "haircut >= 100%");
        require(maxDecayRate_ < RAY, "decay >= 100%");
        minImprovementBps = minImprovementBps_;
        haircutBps = haircutBps_;
        maxDecayRate = maxDecayRate_;
        // Lowering the ceiling below the live rate must lower the live rate too,
        // or the guard on `setDecayRate` would be enforcing a bound the current
        // setting already violates.
        if (decayRatePerBlock > maxDecayRate_) {
            decayRatePerBlock = maxDecayRate_;
            emit DecayRateUpdated(maxDecayRate_);
        }
        emit ParametersUpdated(minImprovementBps_, haircutBps_, maxDecayRate_);
    }

    /// @notice Set the per-block floor decay applied to new bids.
    /// @dev Takes effect on the next bid, never retroactively. A standing slot
    ///      keeps the rate it was struck under, so an underwriter's commitment
    ///      cannot be repriced beneath them by an owner transaction.
    function setDecayRate(uint128 decayRate_) external onlyOwner {
        if (decayRate_ > maxDecayRate) revert DecayTooHigh(decayRate_, maxDecayRate);
        decayRatePerBlock = decayRate_;
        emit DecayRateUpdated(decayRate_);
    }

    // ------------------------------------------------------------ views

    function slots(uint256 assetId) external view returns (Slot memory) {
        return _slots[assetId];
    }

    /// @notice Depositor of the escrowed collateral, or zero if no open slot.
    /// @dev The vault authenticates borrowers against this rather than against
    ///      `ownerOf`, which is the market itself once collateral is escrowed.
    function slotOwner(uint256 assetId) external view returns (address) {
        return _slots[assetId].owner;
    }

    /// @notice Floor as it would stand after accrual at the current block.
    /// @dev Read-only mirror of `_tick`'s decay branch, so the UI and the vault
    ///      never act on a stale floor.
    function currentFloor(uint256 assetId) public view returns (uint256) {
        Slot storage s = _slots[assetId];
        if (s.underwriter == address(0) || s.decayRate == 0) return s.floor;
        uint256 n = block.number - s.lastTick;
        if (n == 0) return s.floor;
        uint256 decayed = s.floor.rmulDown((RAY - s.decayRate).rpow(n));
        uint256 debt = _outstanding(assetId);
        return decayed < debt ? debt : decayed;
    }

    /// @notice Maximum principal borrowable against the current floor.
    function maxBorrow(uint256 assetId) external view returns (uint256) {
        return currentFloor(assetId) * (BPS - haircutBps) / BPS;
    }

    // ------------------------------------------------------- slot lifecycle

    /// @notice Open bidding on an asset and fund the premium reserve.
    /// @dev The borrower funds the premium because they are the party buying
    ///      credit. Streaming from a pre-funded reserve keeps every unit of
    ///      accrued premium fully backed - the market can never owe an
    ///      underwriter money it does not hold. (INV-2)
    function openSlot(uint256 assetId, uint256 premiumReserve) external nonReentrant {
        if (assetRegistry.ownerOf(assetId) != msg.sender) {
            revert NotAssetOwner(assetId, msg.sender);
        }
        Slot storage s = _slots[assetId];
        if (s.open) revert SlotAlreadyOpen(assetId);
        if (premiumReserve == 0) revert ZeroAmount();

        s.open = true;
        s.owner = msg.sender;
        s.lastTick = uint64(block.number);
        s.premiumReserve += premiumReserve;
        totalLiabilities += premiumReserve;

        escrowToken.safeTransferFrom(msg.sender, address(this), premiumReserve);
        // Collateral is escrowed here, not at origination. A firm bid is a
        // commitment to buy THIS asset; if the owner could sell it out from
        // under a standing bid, the bid would be unbacked.
        assetRegistry.transferFrom(msg.sender, address(this), assetId);
        emit SlotOpened(assetId, msg.sender, premiumReserve);
    }

    /// @notice Add to the premium reserve of an open slot.
    function fundPremium(uint256 assetId, uint256 amount) external nonReentrant {
        Slot storage s = _slots[assetId];
        if (!s.open) revert SlotNotOpen(assetId);
        if (amount == 0) revert ZeroAmount();

        _tick(assetId);
        s.premiumReserve += amount;
        totalLiabilities += amount;

        escrowToken.safeTransferFrom(msg.sender, address(this), amount);
        emit PremiumFunded(assetId, msg.sender, amount);
    }

    /// @notice Place or contest a firm bid.
    /// @param newFloor  Purchase price committed to, escrowed in full.
    /// @param newRate   Per-block premium as a RAY fraction of `floor`.
    ///
    /// @dev A contest must be strictly better on at least one axis and no worse
    ///      on either. Because "better" always means better *for the borrower*,
    ///      front-running a contest can only improve the borrower's terms -
    ///      the usual MEV harm is structurally absent here.
    function bid(uint256 assetId, uint256 newFloor, uint128 newRate) external nonReentrant {
        if (!compliance.canUnderwrite(msg.sender)) revert NotPermitted(msg.sender);

        Slot storage s = _slots[assetId];
        if (!s.open) revert SlotNotOpen(assetId);
        if (newFloor == 0) revert ZeroAmount();

        _tick(assetId);

        address prev = s.underwriter;

        if (prev != address(0)) {
            uint256 curFloor = s.floor;
            uint256 curRate = s.premiumRate;

            // no worse on either axis
            if (newFloor < curFloor || newRate > curRate) {
                revert BidNotBetter(newFloor, newRate, curFloor, curRate);
            }
            // strictly better on at least one, by the minimum delta
            bool floorBetter =
                newFloor >= curFloor + (curFloor * minImprovementBps / BPS) && newFloor > curFloor;
            bool rateBetter = curRate > 0
                && newRate <= curRate - (curRate * minImprovementBps / BPS) && newRate < curRate;
            if (!floorBetter && !rateBetter) {
                revert BidNotBetter(newFloor, newRate, curFloor, curRate);
            }
        }

        uint256 debt = _outstanding(assetId);
        if (newFloor < debt) revert BelowOutstandingDebt(newFloor, debt);

        // ---- effects
        uint256 refund = s.escrow;
        uint256 owed = s.accrued;

        s.underwriter = msg.sender;
        s.floor = newFloor;
        s.escrow = newFloor;
        s.premiumRate = newRate;
        s.decayRate = decayRatePerBlock;
        s.accrued = 0;
        s.lastTick = uint64(block.number);

        // liabilities: drop the outgoing escrow+accrued, add the incoming escrow
        totalLiabilities = totalLiabilities - refund - owed + newFloor;

        // ---- interactions
        escrowToken.safeTransferFrom(msg.sender, address(this), newFloor);
        if (prev != address(0)) {
            escrowToken.safeTransfer(prev, refund + owed); // INV-5: refunded in full
        }

        emit BidPlaced(assetId, msg.sender, prev, newFloor, newRate);
    }

    /// @notice Underwriter exits their slot. Only possible with no debt open.
    function withdrawBid(uint256 assetId) external nonReentrant {
        Slot storage s = _slots[assetId];
        if (s.underwriter != msg.sender) revert NotIncumbent(assetId, msg.sender);

        uint256 debt = _outstanding(assetId);
        if (debt != 0) revert DebtOutstanding(assetId, debt);

        _tick(assetId);

        uint256 amount = s.escrow + s.accrued;
        s.underwriter = address(0);
        s.floor = 0;
        s.escrow = 0;
        s.accrued = 0;
        s.premiumRate = 0;
        totalLiabilities -= amount;

        escrowToken.safeTransfer(msg.sender, amount);
        emit BidWithdrawn(assetId, msg.sender, amount);
    }

    /// @notice Underwriter withdraws premium earned so far.
    function claimPremium(uint256 assetId) external nonReentrant returns (uint256 amount) {
        Slot storage s = _slots[assetId];
        if (s.underwriter != msg.sender) revert NotIncumbent(assetId, msg.sender);

        _tick(assetId);
        amount = s.accrued;
        if (amount == 0) return 0;

        s.accrued = 0;
        totalLiabilities -= amount;

        escrowToken.safeTransfer(msg.sender, amount);
        emit PremiumClaimed(assetId, msg.sender, amount);
    }

    /// @notice Asset owner closes an empty slot and reclaims unspent premium.
    function closeSlot(uint256 assetId) external nonReentrant {
        Slot storage s = _slots[assetId];
        if (s.owner != msg.sender) revert NotAssetOwner(assetId, msg.sender);
        if (!s.open) revert SlotNotOpen(assetId);
        if (s.underwriter != address(0)) revert NoIncumbent(assetId);

        uint256 debt = _outstanding(assetId);
        if (debt != 0) revert DebtOutstanding(assetId, debt);

        uint256 refund = s.premiumReserve;
        s.open = false;
        s.owner = address(0);
        s.premiumReserve = 0;
        totalLiabilities -= refund;

        if (refund != 0) escrowToken.safeTransfer(msg.sender, refund);
        assetRegistry.transferFrom(address(this), msg.sender, assetId);
        emit SlotClosed(assetId);
    }

    // ---------------------------------------------------------- settlement

    /// @notice Settle a defaulted position: escrow to the lender, asset to the
    ///         underwriter. One block, no auction, no oracle, no market.
    ///
    /// @dev The underwriter pays the CURRENT floor, not the floor they bid.
    ///      That is correct: decay means the standing bid has fallen, and the
    ///      standing bid is the price. Because `_tick` clamps decay at the
    ///      outstanding debt, the lender is always made whole first, and the
    ///      underwriter is refunded the difference.
    function settleDefault(uint256 assetId) external nonReentrant {
        if (address(loanVault) == address(0)) revert VaultUnset();
        if (!loanVault.isDefaulted(assetId)) revert NotDefaulted(assetId);

        Slot storage s = _slots[assetId];
        address uw = s.underwriter;
        if (uw == address(0)) revert NoIncumbent(assetId);

        _tick(assetId);

        address owner_ = s.owner;
        uint256 price = s.floor;
        uint256 escrowHeld = s.escrow;
        uint256 owed = s.accrued;
        uint256 reserve = s.premiumReserve;
        uint256 refund = escrowHeld - price + owed; // escrow >= floor by INV-1

        // ---- effects
        delete _slots[assetId];
        totalLiabilities -= (escrowHeld + owed + reserve);

        // ---- interactions
        escrowToken.forceApprove(address(loanVault), price);
        loanVault.absorbSettlement(assetId, price);
        escrowToken.forceApprove(address(loanVault), 0);

        if (refund != 0) escrowToken.safeTransfer(uw, refund);

        // Unspent premium returns to the borrower who funded it. Paying it to
        // the underwriter would hand them unearned income at the moment the
        // commitment ends - an incentive to push borrowers into default, which
        // is the one incentive a credit protocol must never create.
        if (reserve != 0) escrowToken.safeTransfer(owner_, reserve);

        assetRegistry.transferFrom(address(this), uw, assetId);

        emit Settled(assetId, uw, price, refund);
    }

    // ------------------------------------------------------------- internals

    function tick(uint256 assetId) external {
        _tick(assetId);
    }

    /// @dev Lazy, O(log n) accrual. Cost does not scale with the number of
    ///      slots, participants, or elapsed blocks.
    ///
    ///      Premium is capped by the reserve, so accrual is always backed.
    ///      Decay is clamped at the outstanding debt, so a decaying floor can
    ///      compress headroom - which is what makes a loan callable - but can
    ///      never leave the lender under-covered.
    function _tick(uint256 assetId) internal {
        Slot storage s = _slots[assetId];
        if (s.underwriter == address(0)) {
            s.lastTick = uint64(block.number);
            return;
        }

        uint256 n = block.number - s.lastTick;
        if (n == 0) return;

        // --- premium accrual, capped at the funded reserve
        if (s.premiumRate != 0 && s.premiumReserve != 0) {
            uint256 owed = s.floor.rmulDown(uint256(s.premiumRate) * n);
            uint256 reserve = s.premiumReserve;
            if (owed > reserve) owed = reserve;
            unchecked {
                s.premiumReserve = reserve - owed;
                s.accrued += owed;
            }
        }

        // --- floor decay, clamped at outstanding debt
        if (s.decayRate != 0) {
            uint256 decayed = s.floor.rmulDown((RAY - s.decayRate).rpow(n));
            uint256 debt = _outstanding(assetId);
            s.floor = decayed < debt ? debt : decayed;
        }

        s.lastTick = uint64(block.number);
        emit Ticked(assetId, s.floor, s.accrued, s.premiumReserve);
    }

    function _outstanding(uint256 assetId) internal view returns (uint256) {
        ILoanVault v = loanVault;
        if (address(v) == address(0)) return 0;
        return v.outstanding(assetId);
    }
}
