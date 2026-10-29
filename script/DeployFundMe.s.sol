// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FundMe} from "../src/FundMe.sol";
import {MockV3Aggregator} from "../test/mocks/MockV3Aggregator.sol";

interface VmDeploy {
    function envAddress(string calldata) external returns (address);
    function envUint(string calldata) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployFundMe {
    VmDeploy constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (FundMe deployed) {
        address feed;
        uint256 maxAge;
        if (block.chainid != 31337) {
            feed = vm.envAddress("PRICE_FEED");
            maxAge = vm.envUint("MAX_PRICE_AGE");
        }
        vm.startBroadcast();
        if (block.chainid == 31337) {
            feed = address(new MockV3Aggregator(8, 2000e8));
            maxAge = 3600;
        }
        deployed = new FundMe(feed, maxAge);
        vm.stopBroadcast();
    }
}
