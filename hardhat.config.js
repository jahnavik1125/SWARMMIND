require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    mstTestnet: {
      url: process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com",
      chainId: process.env.MST_CHAIN_ID ? parseInt(process.env.MST_CHAIN_ID) : 91562037,
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY.startsWith("0x") ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`]
        : [],
    },
  },
  etherscan: {
    apiKey: {
      mstTestnet: "empty",
    },
    customChains: [
      {
        network: "mstTestnet",
        chainId: process.env.MST_CHAIN_ID ? parseInt(process.env.MST_CHAIN_ID) : 91562037,
        urls: {
          apiURL: process.env.MST_EXPLORER_URL ? `${process.env.MST_EXPLORER_URL}/api` : "https://testnet.mstscan.com/api",
          browserURL: process.env.MST_EXPLORER_URL || "https://testnet.mstscan.com",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
