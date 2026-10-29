// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title FundMe
/// @notice Owner-managed ETH donations; no refund, goal or deadline mechanism.
/// @dev Lifetime accounting avoids withdrawal loops over an unbounded donor list.
contract FundMe {
    error InvalidConfiguration();
    error InvalidPrice();
    error StalePrice();
    error BelowMinimum(uint256 receivedUsd, uint256 minimumUsd);
    error Unauthorized();
    error Reentrancy();
    error EmptyBalance();
    error TransferFailed();

    uint256 public constant MINIMUM_USD = 5e18;
    address public immutable owner;
    AggregatorV3Interface public immutable priceFeed;
    uint256 public immutable maxPriceAge;
    uint256 private immutable priceScale;

    mapping(address => uint256) public contributions;
    uint256 public totalRaised;
    uint256 public totalWithdrawn;
    uint256 private locked = 1;

    event Funded(address indexed donor, uint256 amountWei, uint256 amountUsd);
    event Withdrawn(address indexed recipient, uint256 amountWei);

    constructor(address feed, uint256 priceAge) {
        if (feed.code.length == 0 || priceAge == 0) revert InvalidConfiguration();
        uint8 feedDecimals = AggregatorV3Interface(feed).decimals();
        if (feedDecimals > 18) revert InvalidConfiguration();
        owner = msg.sender;
        priceFeed = AggregatorV3Interface(feed);
        maxPriceAge = priceAge;
        priceScale = 10 ** uint256(feedDecimals);
    }

    /// @return USD value scaled by 1e18, rounded down.
    function getUsdValue(uint256 amountWei) public view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert InvalidPrice();
        if (block.timestamp - updatedAt > maxPriceAge) revert StalePrice();
        return amountWei * uint256(answer) / priceScale;
    }

    function fund() public payable {
        uint256 usd = getUsdValue(msg.value);
        if (usd < MINIMUM_USD) revert BelowMinimum(usd, MINIMUM_USD);
        contributions[msg.sender] += msg.value;
        totalRaised += msg.value;
        emit Funded(msg.sender, msg.value, usd);
    }

    /// @notice Withdraws to the deploying owner. Donor totals remain historical.
    function withdraw() external {
        if (msg.sender != owner) revert Unauthorized();
        if (locked != 1) revert Reentrancy();
        uint256 amount = address(this).balance;
        if (amount == 0) revert EmptyBalance();
        locked = 2;
        totalWithdrawn += amount;
        (bool success,) = payable(owner).call{value: amount}("");
        if (!success) revert TransferFailed();
        locked = 1;
        emit Withdrawn(owner, amount);
    }

    receive() external payable {
        fund();
    }

    fallback() external payable {
        fund();
    }
}
