// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundMe} from "../src/FundMe.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";

// Small explicit cheatcode interface keeps this starter free of external libraries.
interface Vm {
    function deal(address, uint256) external;
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
}

contract FundMeTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FundMe fundMe;
    MockV3Aggregator feed;
    address constant DONOR = address(0xBEEF);
    event Funded(address indexed donor, uint256 amountWei, uint256 amountUsd);
    event Withdrawn(address indexed recipient, uint256 amountWei);

    receive() external payable {}

    function setUp() public {
        vm.warp(10_000);
        feed = new MockV3Aggregator(8, 2000e8);
        fundMe = new FundMe(address(feed), 3600);
        vm.deal(DONOR, 100 ether);
    }

    function testInitialConfiguration() public view {
        require(fundMe.owner() == address(this));
        require(address(fundMe.priceFeed()) == address(feed));
        require(fundMe.maxPriceAge() == 3600);
        require(fundMe.getUsdValue(1 ether) == 2000e18);
    }

    function testFundAtExactMinimumEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Funded(DONOR, 0.0025 ether, 5e18);
        vm.prank(DONOR);
        fundMe.fund{value: 0.0025 ether}();
        require(fundMe.contributions(DONOR) == 0.0025 ether);
        require(fundMe.totalRaised() == 0.0025 ether);
    }

    function testRejectBelowMinimum() public {
        vm.expectRevert(abi.encodeWithSelector(FundMe.BelowMinimum.selector, uint256(2e18), uint256(5e18)));
        vm.prank(DONOR);
        fundMe.fund{value: 0.001 ether}();
    }

    function testReceiveAndFallbackAccumulate() public {
        vm.prank(DONOR);
        (bool ok,) = address(fundMe).call{value: 0.01 ether}("");
        require(ok);
        vm.prank(DONOR);
        (ok,) = address(fundMe).call{value: 0.01 ether}(hex"deadbeef");
        require(ok && fundMe.contributions(DONOR) == 0.02 ether);
    }

    function testOnlyOwnerCanWithdraw() public {
        vm.expectRevert(FundMe.Unauthorized.selector);
        vm.prank(DONOR);
        fundMe.withdraw();
    }

    function testWithdrawPreservesHistoryAndAllowsNextDonation() public {
        vm.prank(DONOR);
        fundMe.fund{value: 1 ether}();
        uint256 beforeBalance = address(this).balance;
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(address(this), 1 ether);
        fundMe.withdraw();
        require(address(this).balance == beforeBalance + 1 ether);
        require(address(fundMe).balance == 0 && fundMe.totalWithdrawn() == 1 ether);
        require(fundMe.contributions(DONOR) == 1 ether);
        vm.prank(DONOR);
        fundMe.fund{value: 0.01 ether}();
        require(fundMe.totalRaised() == 1.01 ether);
    }

    function testRejectEmptyWithdrawal() public {
        vm.expectRevert(FundMe.EmptyBalance.selector);
        fundMe.withdraw();
    }

    function testRejectStalePrice() public {
        vm.warp(13_601);
        vm.expectRevert(FundMe.StalePrice.selector);
        fundMe.getUsdValue(1 ether);
    }

    function testAcceptAtFreshnessBoundary() public {
        vm.warp(13_600);
        require(fundMe.getUsdValue(1 ether) == 2000e18);
    }

    function testRejectInvalidPricesAndTimestamps() public {
        feed.setRound(0, block.timestamp);
        vm.expectRevert(FundMe.InvalidPrice.selector);
        fundMe.getUsdValue(1 ether);
        feed.setRound(-1, block.timestamp);
        vm.expectRevert(FundMe.InvalidPrice.selector);
        fundMe.getUsdValue(1 ether);
        feed.setRound(2000e8, 0);
        vm.expectRevert(FundMe.InvalidPrice.selector);
        fundMe.getUsdValue(1 ether);
        feed.setRound(2000e8, block.timestamp + 1);
        vm.expectRevert(FundMe.InvalidPrice.selector);
        fundMe.getUsdValue(1 ether);
    }

    function testSupportsEighteenDecimalFeed() public {
        MockV3Aggregator other = new MockV3Aggregator(18, 2000e18);
        FundMe another = new FundMe(address(other), 3600);
        require(another.getUsdValue(1 ether) == 2000e18);
    }

    function testRejectInvalidConfiguration() public {
        vm.expectRevert(FundMe.InvalidConfiguration.selector);
        new FundMe(address(0), 3600);
        vm.expectRevert(FundMe.InvalidConfiguration.selector);
        new FundMe(address(feed), 0);
        MockV3Aggregator other = new MockV3Aggregator(19, 1);
        vm.expectRevert(FundMe.InvalidConfiguration.selector);
        new FundMe(address(other), 3600);
    }

    function testFuzzDonationAccounting(uint96 raw) public {
        uint256 amount = 0.0025 ether + uint256(raw) % 90 ether;
        vm.prank(DONOR);
        fundMe.fund{value: amount}();
        require(fundMe.totalRaised() == amount);
        require(fundMe.contributions(DONOR) == amount);
        require(address(fundMe).balance == amount);
    }

    function testTransferFailureRollsBackAccounting() public {
        OwnerReceiver receiver = new OwnerReceiver(address(feed));
        FundMe target = receiver.target();
        vm.prank(DONOR);
        target.fund{value: 1 ether}();
        receiver.configure(true, false);
        vm.expectRevert(FundMe.TransferFailed.selector);
        receiver.withdraw();
        require(target.totalWithdrawn() == 0 && address(target).balance == 1 ether);
        receiver.configure(false, false);
        receiver.withdraw();
        require(target.totalWithdrawn() == 1 ether);
    }

    function testOwnerCannotReenterWithdrawal() public {
        OwnerReceiver receiver = new OwnerReceiver(address(feed));
        vm.prank(DONOR);
        receiver.target().fund{value: 1 ether}();
        receiver.configure(false, true);
        receiver.withdraw();
        require(receiver.blocked());
        require(receiver.target().totalWithdrawn() == 1 ether);
    }
}

contract OwnerReceiver {
    FundMe public target;
    bool public reject;
    bool public attack;
    bool public blocked;

    constructor(address feed) {
        target = new FundMe(feed, 3600);
    }

    function configure(bool reject_, bool attack_) external {
        reject = reject_;
        attack = attack_;
    }

    function withdraw() external {
        target.withdraw();
    }

    receive() external payable {
        require(!reject, "reject ETH");
        if (attack) {
            (bool ok, bytes memory data) = address(target).call(abi.encodeCall(FundMe.withdraw, ()));
            blocked = !ok && keccak256(data) == keccak256(abi.encodeWithSelector(FundMe.Reentrancy.selector));
        }
    }
}
