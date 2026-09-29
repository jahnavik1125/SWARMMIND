const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function main() {
  console.log("============================================================");
  console.log("  SWARMMIND ON-CHAIN VERIFICATION (MST TESTNET)             ");
  console.log("============================================================");

  const deployedPath = path.join(__dirname, "..", "deployed-contracts.json");
  if (!fs.existsSync(deployedPath)) {
    console.error("No deployed-contracts.json file found!");
    process.exit(1);
  }

  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  console.log(`Network               : ${deployed.network} (Chain ID: ${deployed.chainId})`);
  console.log(`Deployed At           : ${deployed.deployedAt}`);
  console.log(`Deployer Account      : ${deployed.deployer}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // 1. Verify Chain ID
  const net = await provider.getNetwork();
  console.log(`\n1. Chain ID Check`);
  console.log(`   Connected Chain ID : ${net.chainId}`);
  if (Number(net.chainId) !== TARGET_CHAIN_ID) {
    throw new Error(`Chain ID mismatch! Expected ${TARGET_CHAIN_ID} but got ${net.chainId}`);
  }
  console.log(`   Status             : PASS [Chain ID matches MST Testnet]`);

  // 2. Verify MVPControlledResolver Bytecode
  const resolverAddress = deployed.contracts.MVPControlledResolver.address;
  console.log(`\n2. MVPControlledResolver Check`);
  console.log(`   Contract Address   : ${resolverAddress}`);
  const resolverCode = await provider.getCode(resolverAddress);
  if (resolverCode === "0x" || resolverCode.length <= 2) {
    throw new Error(`MVPControlledResolver at ${resolverAddress} has no on-chain bytecode!`);
  }
  console.log(`   Bytecode Size      : ${resolverCode.length / 2 - 1} bytes on-chain`);

  const resolverArtifact = getArtifact(path.join("resolvers", "MVPControlledResolver.sol", "MVPControlledResolver.json"));
  const resolverContract = new ethers.Contract(resolverAddress, resolverArtifact.abi, provider);
  const resolverOwner = await resolverContract.owner();
  const sampleResolved = await resolverContract.isResolved(1);
  console.log(`   Resolver Owner     : ${resolverOwner}`);
  console.log(`   isResolved(1)      : ${sampleResolved} (callable without revert)`);
  console.log(`   Status             : PASS [Resolver Bytecode & Read-only Methods Verified]`);

  // 3. Verify SwarmMindCore Bytecode & Read-only State
  const coreAddress = deployed.contracts.SwarmMindCore.address;
  console.log(`\n3. SwarmMindCore Check`);
  console.log(`   Contract Address   : ${coreAddress}`);
  const coreCode = await provider.getCode(coreAddress);
  if (coreCode === "0x" || coreCode.length <= 2) {
    throw new Error(`SwarmMindCore at ${coreAddress} has no on-chain bytecode!`);
  }
  console.log(`   Bytecode Size      : ${coreCode.length / 2 - 1} bytes on-chain`);

  const coreArtifact = getArtifact(path.join("SwarmMindCore.sol", "SwarmMindCore.json"));
  const coreContract = new ethers.Contract(coreAddress, coreArtifact.abi, provider);

  const coreOwner = await coreContract.owner();
  const maxReputation = await coreContract.MAX_REPUTATION();
  const baseWeight = await coreContract.BASE_REPUTATION_WEIGHT();
  const nextSwarmId = await coreContract.nextSwarmId();
  const allAgents = await coreContract.getAllAgentIds();

  console.log(`   SwarmMindCore Owner: ${coreOwner}`);
  console.log(`   MAX_REPUTATION     : ${maxReputation} bps (100.00%)`);
  console.log(`   BASE_WEIGHT        : ${baseWeight}`);
  console.log(`   nextSwarmId        : ${nextSwarmId}`);
  console.log(`   Registered Agents  : ${allAgents.length}`);
  console.log(`   Status             : PASS [SwarmMindCore Bytecode & Getters Verified]`);

  console.log("\n============================================================");
  console.log("  ALL ON-CHAIN VERIFICATIONS PASSED                         ");
  console.log("============================================================");
  console.log(`Resolver Explorer  : https://testnet.mstscan.com/address/${resolverAddress}`);
  console.log(`SwarmMindCore Explorer: https://testnet.mstscan.com/address/${coreAddress}`);
}

main().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
