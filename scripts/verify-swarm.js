const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

const EXPECTED_AGENTS = [
  "0x4f593aa368b69c663a279a652ffdce8e2a7da9526492ac357472105aa758162b", // ALPHA
  "0x2bb519c2d3835d6116adade05fdda3b9ddf2f4ef94bd343af59a317aee0cb1f4", // BETA
  "0x2d9cbf004444d64e839bc520559f8047edd707a24ee15171f56648797edad560"  // GAMMA
];

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function verifySwarmOnChain(swarmId = 1) {
  console.log("============================================================");
  console.log(`  SWARMMIND ON-CHAIN SWARM #${swarmId} VERIFICATION        `);
  console.log("============================================================");

  const deployedPath = path.join(__dirname, "..", "deployed-contracts.json");
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const coreAddress = deployed.contracts.SwarmMindCore.address;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const coreArtifact = getArtifact(path.join("SwarmMindCore.sol", "SwarmMindCore.json"));
  const core = new ethers.Contract(coreAddress, coreArtifact.abi, provider);

  const swarm = await core.getSwarm(swarmId);
  const selected = await core.getSwarmSelectedAgents(swarmId);

  const stateNames = ["Created", "AgentsSelected", "Revealing", "Resolved", "Settled", "Cancelled"];

  console.log(`Swarm ID           : ${swarm.swarmId}`);
  console.log(`Creator            : ${swarm.creator}`);
  console.log(`Question Hash      : ${swarm.questionHash}`);
  console.log(`Required Capability: ${swarm.requiredCapability}`);
  console.log(`Escrowed Bounty    : ${ethers.formatEther(swarm.bounty)} MSTC`);
  console.log(`Commit Deadline    : ${new Date(Number(swarm.commitDeadline) * 1000).toISOString()}`);
  console.log(`Reveal Deadline    : ${new Date(Number(swarm.revealDeadline) * 1000).toISOString()}`);
  console.log(`Required Agents    : ${swarm.requiredAgentCount}`);
  console.log(`Min Bond           : ${ethers.formatEther(swarm.minBond)} MSTC`);
  console.log(`Resolver           : ${swarm.outcomeResolver}`);
  console.log(`State              : ${swarm.state} (${stateNames[Number(swarm.state)]})`);
  console.log(`Selected Agents (${selected.length}):`);
  selected.forEach((id, idx) => console.log(`  ${idx + 1}. ${id}`));

  // Validations
  if (Number(swarm.swarmId) === 0) {
    throw new Error(`Swarm #${swarmId} does not exist on-chain!`);
  }
  if (swarm.requiredCapability !== "WEATHER") {
    throw new Error(`Capability mismatch: expected WEATHER, got ${swarm.requiredCapability}`);
  }
  if (swarm.bounty === 0n) {
    throw new Error("Bounty escrow is 0!");
  }
  if (selected.length !== 3) {
    throw new Error(`Expected 3 selected agents, found ${selected.length}`);
  }

  console.log("\nStatus: PASS [Swarm and Selected Agents Confirmed On-Chain]");
  console.log(`MSTScan Swarm Link : https://testnet.mstscan.com/address/${coreAddress}`);
  console.log("============================================================");

  return {
    swarmId: Number(swarm.swarmId),
    creator: swarm.creator,
    capability: swarm.requiredCapability,
    bounty: ethers.formatEther(swarm.bounty),
    stateName: stateNames[Number(swarm.state)],
    selectedAgents: selected
  };
}

if (require.main === module) {
  verifySwarmOnChain().catch(err => {
    console.error("Verification failed:", err.message);
    process.exit(1);
  });
}

module.exports = { verifySwarmOnChain };
