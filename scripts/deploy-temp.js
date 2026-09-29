const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found at: ${artifactPath}. Please run: npx hardhat compile`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function main() {
  console.log("============================================================");
  console.log("  SWARMMIND TEMPORARY DEPLOYER CLI (MST TESTNET)           ");
  console.log("============================================================");

  const tempWalletPath = path.join(__dirname, "..", ".temp-deployer.json");
  if (!fs.existsSync(tempWalletPath)) {
    console.error("No temporary deployer found! Run: node scripts/create-temp-deployer.js");
    process.exit(1);
  }

  const walletData = JSON.parse(fs.readFileSync(tempWalletPath, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Verify Network
  const net = await provider.getNetwork();
  console.log(`Connected RPC    : ${RPC_URL}`);
  console.log(`Detected Chain ID: ${net.chainId} (Expected: ${TARGET_CHAIN_ID})`);

  if (Number(net.chainId) !== TARGET_CHAIN_ID) {
    throw new Error(`Chain ID mismatch: expected ${TARGET_CHAIN_ID} but got ${net.chainId}`);
  }

  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  console.log(`Deployer Address : ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Current Balance  : ${ethers.formatEther(balance)} MSTC`);

  if (balance === 0n) {
    console.error("\n[ERROR] Deployer wallet has 0 MSTC!");
    console.error(`Please transfer a small amount of testnet MSTC (e.g. 0.05 MSTC)`);
    console.error(`from your BridgeKey wallet to: ${wallet.address}`);
    console.error(`Then re-run this script.`);
    process.exit(1);
  }

  // 1. Deploy MVPControlledResolver
  console.log("\n1. Deploying MVPControlledResolver...");
  const resolverArtifact = getArtifact(path.join("resolvers", "MVPControlledResolver.sol", "MVPControlledResolver.json"));
  const resolverFactory = new ethers.ContractFactory(resolverArtifact.abi, resolverArtifact.bytecode, wallet);
  const resolver = await resolverFactory.deploy();
  console.log(`   Tx Hash: ${resolver.deploymentTransaction().hash}`);
  console.log(`   Explorer: https://testnet.mstscan.com/tx/${resolver.deploymentTransaction().hash}`);
  await resolver.waitForDeployment();
  const resolverAddress = await resolver.getAddress();
  console.log(`   MVPControlledResolver deployed at: ${resolverAddress}`);

  // 2. Deploy SwarmMindCore
  console.log("\n2. Deploying SwarmMindCore...");
  const coreArtifact = getArtifact(path.join("SwarmMindCore.sol", "SwarmMindCore.json"));
  const coreFactory = new ethers.ContractFactory(coreArtifact.abi, coreArtifact.bytecode, wallet);
  const core = await coreFactory.deploy();
  console.log(`   Tx Hash: ${core.deploymentTransaction().hash}`);
  console.log(`   Explorer: https://testnet.mstscan.com/tx/${core.deploymentTransaction().hash}`);
  await core.waitForDeployment();
  const coreAddress = await core.getAddress();
  console.log(`   SwarmMindCore deployed at: ${coreAddress}`);

  const blockNumber = await provider.getBlockNumber();

  // Save metadata
  const deploymentMetadata = {
    network: "mstTestnet",
    chainId: TARGET_CHAIN_ID,
    rpcUrl: RPC_URL,
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    contracts: {
      MVPControlledResolver: {
        address: resolverAddress,
        txHash: resolver.deploymentTransaction().hash,
        blockNumber: blockNumber,
        explorerUrl: `https://testnet.mstscan.com/address/${resolverAddress}`,
        txExplorerUrl: `https://testnet.mstscan.com/tx/${resolver.deploymentTransaction().hash}`,
      },
      SwarmMindCore: {
        address: coreAddress,
        txHash: core.deploymentTransaction().hash,
        blockNumber: blockNumber,
        explorerUrl: `https://testnet.mstscan.com/address/${coreAddress}`,
        txExplorerUrl: `https://testnet.mstscan.com/tx/${core.deploymentTransaction().hash}`,
      },
    },
  };

  const outputPath = path.join(__dirname, "..", "deployed-contracts.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentMetadata, null, 2));
  console.log(`\nDeployment details saved to: ${outputPath}`);

  console.log("\n============================================================");
  console.log("  DEPLOYMENT CONFIRMED ON MST TESTNET                        ");
  console.log("============================================================");
  console.log(`SwarmMindCore  : ${coreAddress}`);
  console.log(`Resolver       : ${resolverAddress}`);
  console.log(`MSTScan Core   : https://testnet.mstscan.com/address/${coreAddress}`);
  console.log(`MSTScan Resolver: https://testnet.mstscan.com/address/${resolverAddress}`);
  console.log("============================================================");
}

main().catch(err => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
