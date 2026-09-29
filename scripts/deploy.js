const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=================================================");
  console.log("  SWARMMIND PROTOCOL — MST TESTNET DEPLOYMENT   ");
  console.log("=================================================");

  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  const netConfig = network.config;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`Deployer Address : ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer Balance : ${ethers.formatEther(balance)} MSTC`);
  console.log(`Target Network   : ${networkName} (Chain ID: ${chainId})`);
  console.log(`RPC URL          : ${netConfig.url || "local in-memory"}`);

  if (balance === 0n && networkName !== "hardhat" && networkName !== "localhost") {
    throw new Error(
      `Deployer ${deployer.address} has 0 MSTC. Please fund your wallet using the MST Testnet faucet.`
    );
  }

  // 1. Deploy MVPControlledResolver
  console.log("\n1. Deploying MVPControlledResolver...");
  const MVPControlledResolver = await ethers.getContractFactory("MVPControlledResolver");
  const resolver = await MVPControlledResolver.deploy();
  await resolver.waitForDeployment();
  const resolverAddress = await resolver.getAddress();
  console.log(`   MVPControlledResolver deployed at: ${resolverAddress}`);

  // 2. Deploy SwarmMindCore
  console.log("\n2. Deploying SwarmMindCore...");
  const SwarmMindCore = await ethers.getContractFactory("SwarmMindCore");
  const swarmMind = await SwarmMindCore.deploy();
  await swarmMind.waitForDeployment();
  const swarmMindAddress = await swarmMind.getAddress();
  console.log(`   SwarmMindCore deployed at: ${swarmMindAddress}`);

  // Deployment Summary & Contract Artifacts
  const deploymentInfo = {
    network: networkName,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      MVPControlledResolver: {
        address: resolverAddress,
        explorerUrl: `https://testnet.mstscan.com/address/${resolverAddress}`,
      },
      SwarmMindCore: {
        address: swarmMindAddress,
        explorerUrl: `https://testnet.mstscan.com/address/${swarmMindAddress}`,
      },
    },
  };

  const outputPath = path.join(__dirname, "..", "deployed-contracts.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment details saved to: ${outputPath}`);

  console.log("\n=================================================");
  console.log("  DEPLOYMENT SUCCESSFUL                          ");
  console.log("=================================================");
  console.log(`SwarmMindCore: ${swarmMindAddress}`);
  console.log(`Resolver:      ${resolverAddress}`);
  console.log(`Explorer:      https://testnet.mstscan.com/address/${swarmMindAddress}`);
  console.log("=================================================");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
