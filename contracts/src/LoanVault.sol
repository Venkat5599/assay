// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {RayMath} from "./libraries/RayMath.sol";
import {ICompliance} from "./interfaces/ICompliance.sol";
import {IAssetRegistry, Receivable} from "./interfaces/IAssetRegistry.sol";
import {IFirmBidMarket} from "./interfaces/IFirmBidMarket.sol";
import {ILoanVault} from "./interfaces/ILoanVault.sol";

/// @title LoanVault
/// @notice Shared stablecoin pool that lends against receivables priced by the
///         firm-bid market.
///
/// @dev THE DIVISION OF LABOUR
///      This contract deliberately contains no novel logic. Every hard question
///      - what is this asset worth, when does the position become unsafe, who
///      absorbs the loss - is answered by the market next door, in capital that
///      somebody escrowed. The vault only does the arithmetic that follows.
///
///      That separation is the point. A conventional lending pool must embed a
///      price oracle and a liquidation engine, and those two components are
///      where lending protocols fail. Here the floor IS the price and the
///      escrow IS the liquidation, so the vault reduces to accounting.
///
/// @dev DEFAULT HAS TWO TRIGGERS
///      1. Maturity. The receivable came due, plus grace, and the debt stands.
///      2. Coverage. Decay pulled the floor down until headroom vanished.
///
///      The second is what makes risk parameters governance-free: an
///      uncontested bid decays every block, so a position that nobody is
///      willing to keep backing becomes callable on its own, with no vote and
///      no keeper deciding when.
///
/// @dev SETTLEMENT IS A SALE, NOT A SEIZURE
///      On default the underwriter buys the asset at the standing floor. Sale
///      proceeds repay the lenders first; any surplus belongs to the borrower,
///      who owned the equity above the debt. Treating the surplus as a lender
///      windfall would make default profitable for the pool, which is exactly
///      the incentive a credit protocol must never create.
contract LoanVault is ILoanVault, ReentrancyGuardTransient, Ownable2Step {
    using SafeERC20 for IERC20;
    using RayMath for uint256;

    uint256 private constant RAY = 1e27;

    // ---------------------------------------------------------------- types

    struct Loan {
        address borrower;
        uint64 openedAt;
        uint256 scaledDebt; // debt / borrowIndex at draw time
    }

    // ---------------------------------------------------------------- state

    IERC20 public immutable asset;
    IAssetRegistry public immutable assetRegistry;

    ICompliance public compliance;
    IFirmBidMarket public market;

    /// @notice Per-block interest rate, RAY. Applied to the borrow index.
    uint128 public ratePerBlock = 1e18; // ~1e-9/block

    /// @notice Seconds past `dueDate` before maturity default can be called.
    uint64 public gracePeriod = 3 days;

    /// @notice Monotonically increasing debt index, RAY.
    uint256 public borrowIndex = RAY;
    uint64 public lastAccrual;

    /// @notice Idle stablecoin held by the pool, excluding borrower surplus.
    /// @dev Tracked explicitly rather than read from `balanceOf`, so a donation
    ///      or a stray transfer cannot silently reprice every lender's share.
    uint256 public totalIdle;

    /// @notice Sum of all scaled debt. Real debt is this times `borrowIndex`.
    uint256 public totalScaledDebt;

    /// @notice Principal the pool has written off as unrecoverable.
    uint256 public badDebt;

    uint256 public totalShares;
    mapping(address lender => uint256) public sharesOf;

    /// @notice Settlement surplus owed to former asset owners.
    mapping(address account => uint256) public claimable;

    mapping(uint256 assetId => Loan) internal _loans;

    // --------------------------------------------------------------- errors

    error NotPermitted(address account);
    error NotAssetOwner(uint256 assetId, address caller);
    error NotMarket(address caller);
    error MarketUnset();
    error ZeroAmount();
    error ExceedsHeadroom(uint256 requested, uint256 available);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error NoLoan(uint256 assetId);
    error LoanOutstanding(uint256 assetId);
    error RateTooHigh(uint128 rate);

    // --------------------------------------------------------------- events

    event Deposited(address indexed lender, uint256 amount, uint256 shares);
    event Withdrawn(address indexed lender, uint256 shares, uint256 amount);
    event Borrowed(uint256 indexed assetId, address indexed borrower, uint256 amount);
    event Repaid(uint256 indexed assetId, address indexed payer, uint256 amount, bool closed);
    event SettlementAbsorbed(
        uint256 indexed assetId,
        uint256 proceeds,
        uint256 debtCleared,
        uint256 surplus,
        uint256 loss
    );
    event SurplusClaimed(address indexed account, uint256 amount);
    event Accrued(uint256 borrowIndex, uint256 interest);
    event ParametersUpdated(uint128 ratePerBlock, uint64 gracePeriod);

    // ---------------------------------------------------------- construction

    constructor(
        address initialOwner,
        IERC20 asset_,
        IAssetRegistry assetRegistry_,
        ICompliance compliance_
    ) Ownable(initialOwner) {
        asset = asset_;
        assetRegistry = assetRegistry_;
        compliance = compliance_;
        lastAccrual = uint64(block.number);
    }

    // ------------------------------------------------------------- admin

    function setMarket(IFirmBidMarket market_) external onlyOwner {
        market = market_;
    }

    function setCompliance(ICompliance compliance_) external onlyOwner {
        compliance = compliance_;
    }

    /// @dev Rate is bounded so a fat-fingered value cannot compound a position
    ///      into default inside a handful of blocks.
    function setParameters(uint128 ratePerBlock_, uint64 gracePeriod_) external onlyOwner {
        if (ratePerBlock_ > 1e21) revert RateTooHigh(ratePerBlock_); // ~1e-6/block ceiling
        _accrue();
        ratePerBlock = ratePerBlock_;
        gracePeriod = gracePeriod_;
        emit ParametersUpdated(ratePerBlock_, gracePeriod_);
    }

    // ------------------------------------------------------------- views

    /// @inheritdoc ILoanVault
    /// @dev Must stay a pure function of vault state. The market calls this
    ///      from inside `currentFloor`; reaching back into the market here
    ///      would close the loop and make both contracts unreadable.
    function outstanding(uint256 assetId) public view returns (uint256) {
        uint256 scaled = _loans[assetId].scaledDebt;
        if (scaled == 0) return 0;
        return scaled.rmul(_projectedIndex());
    }

    /// @inheritdoc ILoanVault
    function isDefaulted(uint256 assetId) external view returns (bool) {
        uint256 debt = outstanding(assetId);
        if (debt == 0) return false;

        Receivable memory r = assetRegistry.receivableOf(assetId);
        if (block.timestamp > uint256(r.dueDate) + gracePeriod) return true;

        // Coverage breach: the standing bid no longer supports the loan.
        if (address(market) == address(0)) return false;
        return debt > market.maxBorrow(assetId);
    }

    function loans(uint256 assetId) external view returns (Loan memory) {
        return _loans[assetId];
    }

    /// @notice Headroom still drawable against this asset.
    function availableToBorrow(uint256 assetId) public view returns (uint256) {
        if (address(market) == address(0)) return 0;
        uint256 cap = market.maxBorrow(assetId);
        uint256 debt = outstanding(assetId);
        return cap > debt ? cap - debt : 0;
    }

    /// @notice Total pool value: idle cash plus outstanding debt.
    function totalAssets() public view returns (uint256) {
        return totalIdle + totalScaledDebt.rmul(_projectedIndex());
    }

    function convertToShares(uint256 amount) public view returns (uint256) {
        uint256 supply = totalShares;
        uint256 assets_ = totalAssets();
        if (supply == 0 || assets_ == 0) return amount;
        return amount * supply / assets_;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalShares;
        if (supply == 0) return 0;
        return shares * totalAssets() / supply;
    }

    // --------------------------------------------------------- lender side

    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        if (!compliance.canLend(msg.sender)) revert NotPermitted(msg.sender);
        _accrue();

        shares = convertToShares(amount);
        if (shares == 0) revert ZeroAmount();

        totalShares += shares;
        sharesOf[msg.sender] += shares;
        totalIdle += amount;

        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, shares);
    }

    /// @dev Withdrawal is bounded by idle cash, not by pool value. Lent capital
    ///      is illiquid until repayment or settlement, and pretending otherwise
    ///      would let an early exit drain the buffer the borrowers rely on.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        _accrue();

        amount = convertToAssets(shares);
        if (amount > totalIdle) revert InsufficientLiquidity(amount, totalIdle);

        totalShares -= shares;
        sharesOf[msg.sender] -= shares;
        totalIdle -= amount;

        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, shares, amount);
    }

    // ------------------------------------------------------- borrower side

    /// @notice Draw against a receivable, capped by the market's derived LTV.
    function borrow(uint256 assetId, uint256 amount) external nonReentrant {
        if (address(market) == address(0)) revert MarketUnset();
        if (amount == 0) revert ZeroAmount();
        if (!compliance.canBorrow(msg.sender)) revert NotPermitted(msg.sender);

        // The market holds the collateral while a slot is live, so `ownerOf` is
        // the market. The depositor it recorded is the real borrower.
        Loan storage l = _loans[assetId];
        if (l.borrower == address(0)) {
            if (market.slotOwner(assetId) != msg.sender) {
                revert NotAssetOwner(assetId, msg.sender);
            }
            l.borrower = msg.sender;
            l.openedAt = uint64(block.timestamp);
        } else if (l.borrower != msg.sender) {
            revert NotAssetOwner(assetId, msg.sender);
        }

        _accrue();

        uint256 room = availableToBorrow(assetId);
        if (amount > room) revert ExceedsHeadroom(amount, room);
        if (amount > totalIdle) revert InsufficientLiquidity(amount, totalIdle);

        uint256 scaled = amount.rdiv(borrowIndex);
        l.scaledDebt += scaled;
        totalScaledDebt += scaled;
        totalIdle -= amount;

        asset.safeTransfer(msg.sender, amount);
        emit Borrowed(assetId, msg.sender, amount);
    }

    /// @notice Repay principal and interest. Anyone may repay on a borrower's
    ///         behalf; the collateral still returns to the borrower.
    function repay(uint256 assetId, uint256 amount) external nonReentrant returns (uint256 paid) {
        if (amount == 0) revert ZeroAmount();
        _accrue();

        Loan storage l = _loans[assetId];
        if (l.borrower == address(0)) revert NoLoan(assetId);

        uint256 debt = l.scaledDebt.rmul(borrowIndex);
        paid = amount > debt ? debt : amount;

        uint256 scaled = paid == debt ? l.scaledDebt : paid.rdiv(borrowIndex);
        if (scaled > l.scaledDebt) scaled = l.scaledDebt;

        l.scaledDebt -= scaled;
        totalScaledDebt -= scaled;
        totalIdle += paid;

        bool closed = l.scaledDebt == 0;
        if (closed) delete _loans[assetId];

        asset.safeTransferFrom(msg.sender, address(this), paid);
        emit Repaid(assetId, msg.sender, paid, closed);
    }

    // ---------------------------------------------------------- settlement

    /// @inheritdoc ILoanVault
    /// @dev Called by the market inside `settleDefault`, which has already
    ///      approved `amount`. Pulling rather than receiving keeps the token
    ///      movement inside this contract's own accounting.
    function absorbSettlement(uint256 assetId, uint256 amount) external nonReentrant {
        if (msg.sender != address(market)) revert NotMarket(msg.sender);
        _accrue();

        Loan storage l = _loans[assetId];
        address borrower = l.borrower;
        uint256 debt = l.scaledDebt.rmul(borrowIndex);

        uint256 cleared = amount > debt ? debt : amount;
        uint256 surplus = amount - cleared;
        uint256 loss = debt - cleared;

        totalScaledDebt -= l.scaledDebt;
        delete _loans[assetId];

        totalIdle += cleared;
        if (loss != 0) badDebt += loss;
        if (surplus != 0 && borrower != address(0)) claimable[borrower] += surplus;

        if (amount != 0) asset.safeTransferFrom(msg.sender, address(this), amount);
        emit SettlementAbsorbed(assetId, amount, cleared, surplus, loss);
    }

    /// @notice Withdraw sale proceeds left over after a settlement repaid the debt.
    function claimSurplus() external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) revert ZeroAmount();
        claimable[msg.sender] = 0;
        asset.safeTransfer(msg.sender, amount);
        emit SurplusClaimed(msg.sender, amount);
    }

    // ------------------------------------------------------------ internals

    /// @dev Lazy interest accrual. O(log n) in elapsed blocks via `rpow`, so an
    ///      idle pool costs the same to wake as a busy one.
    function _accrue() internal {
        uint256 n = block.number - lastAccrual;
        if (n == 0) return;
        lastAccrual = uint64(block.number);
        if (totalScaledDebt == 0 || ratePerBlock == 0) return;

        uint256 before = totalScaledDebt.rmul(borrowIndex);
        borrowIndex = borrowIndex.rmulDown((RAY + ratePerBlock).rpow(n));
        emit Accrued(borrowIndex, totalScaledDebt.rmul(borrowIndex) - before);
    }

    /// @dev The index as it would stand after accrual at the current block.
    ///      Views must project it, or the market would tick against stale debt.
    function _projectedIndex() internal view returns (uint256) {
        uint256 n = block.number - lastAccrual;
        if (n == 0 || ratePerBlock == 0) return borrowIndex;
        return borrowIndex.rmulDown((RAY + uint256(ratePerBlock)).rpow(n));
    }
}
