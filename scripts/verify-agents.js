const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

const TARGET_AGENTS = [
  {
    name: "WEATHER_ALPHA",
    id: "0x4f593aa368b69c663a279a652ffdce8e2a7da9526492ac357472105aa758162b",
    capability: "WEATHER",
    metadataUri: "ipfs://bafkreiaweatheralpha01",
    role: "Numerical Weather Prediction & Precipitation Forecaster"
  },
  {
    name: "WEATHER_BETA",
    id: "0x2bb519c2d3835d6116adade05fdda3b9ddf2f4ef94bd343af59a317aee0cb1f4",
    capability: "WEATHER",
    metadataUri: "ipfs://bafkreiaweatherbeta02",
    role: "Atmospheric Moisture Flux & Satellite Radar Forecaster"
  },
  {
    name: "WEATHER_GAMMA",
    id: "0x2d9cbf004444d64e839bc520559f8047edd707a24ee15171f56648797edad560",
    capability: "WEATHER",
    metadataUri: "ipfs://bafkreiaweathergamma03",
    role: "Microclimate Analyst & Climatological Critic"
  }
];

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function main() {
  console.log("============================================================");
  console.log("  SWARMMIND ON-CHAIN AGENT VERIFICATION (MST TESTNET)       ");
  console.log("============================================================");

  const deployedPath = path.join(__dirname, "..", "deployed-contracts.json");
  if (!fs.existsSync(deployedPath)) {
    console.error("deployed-contracts.json not found!");
    process.exit(1);
  }

  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const coreAddress = deployed.contracts.SwarmMindCore.address;
  const expectedOwner = deployed.deployer;

  console.log(`SwarmMindCore Address: ${coreAddress}`);
  console.log(`Expected Owner       : ${expectedOwner}`);
  console.log(`Target Network       : ${deployed.network} (Chain ID: ${deployed.chainId})`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // 1. Check Chain ID
  const net = await provider.getNetwork();
  console.log(`\n1. Network Verification`);
  console.log(`   Connected Chain ID: ${net.chainId}`);
  if (Number(net.chainId) !== TARGET_CHAIN_ID) {
    throw new Error(`Chain ID mismatch! Expected ${TARGET_CHAIN_ID} but got ${net.chainId}`);
  }
  console.log(`   Status            : PASS [MST Testnet Verified]`);

  // 2. Query SwarmMindCore Agents
  const coreArtifact = getArtifact(path.join("SwarmMindCore.sol", "SwarmMindCore.json"));
  const coreContract = new ethers.Contract(coreAddress, coreArtifact.abi, provider);

  const allAgentIds = await coreContract.getAllAgentIds();
  console.log(`\n2. Registry Capacity Check`);
  console.log(`   Total On-Chain Agents: ${allAgentIds.length}`);

  let verifiedCount = 0;

  for (let i = 0; i < TARGET_AGENTS.length; i++) {
    const target = TARGET_AGENTS[i];
    console.log(`\n3.${i + 1} Verifying Agent: ${target.name}`);
    console.log(`   Expected AgentId : ${target.id}`);

    try {
      const agent = await coreContract.getAgent(target.id);
      const rep = await coreContract.getAgentReputation(target.id, target.capability);

      console.log(`   Registered Owner : ${agent.owner}`);
      console.log(`   Capability       : ${agent.capability}`);
      console.log(`   Active Status    : ${agent.active}`);
      console.log(`   Registered At    : ${new Date(Number(agent.registeredAt) * 1000).toISOString()}`);
      console.log(`   Domain Reputation: ${rep} bps (Expected initial: 0)`);
      console.log(`   Metadata URI     : ${agent.metadataUri}`);

      // Validations
      if (agent.owner.toLowerCase() !== expectedOwner.toLowerCase()) {
        throw new Error(`Owner mismatch for ${target.name}: expected ${expectedOwner} but got ${agent.owner}`);
      }
      if (agent.capability !== target.capability) {
        throw new Error(`Capability mismatch: expected ${target.capability} but got ${agent.capability}`);
      }
      if (!agent.active) {
        throw new Error(`Agent ${target.name} is not active!`);
      }
      if (Number(rep) !== 0) {
        throw new Error(`Initial reputation should be 0, got ${rep}`);
      }

      console.log(`   Status           : PASS [Valid On-Chain Agent]`);
      verifiedCount++;
    } catch (err) {
      console.log(`   Status           : FAILED / NOT REGISTERED YET (${err.message})`);
    }
  }

  // 4. Duplicate Rejection Test Simulation
  console.log(`\n4. Duplicate Registration Rejection Check`);
  if (verifiedCount > 0) {
    try {
      // Simulate static call of duplicate registration with agent 0
      const firstAgent = TARGET_AGENTS[0];
      await coreContract.registerAgent.staticCall(
        firstAgent.id,
        firstAgent.capability,
        firstAgent.metadataUri,
        { from: expectedOwner }
      );
      console.log(`   Status           : FAILED [Duplicate registration did not revert!]`);
    } catch (revertErr) {
      console.log(`   Duplicate Revert : "${revertErr.shortMessage || revertErr.message}"`);
      console.log(`   Status           : PASS [Duplicate registration safely rejected on-chain]`);
    }
  } else {
    console.log(`   Skipped (Agents not yet registered)`);
  }

  console.log("\n============================================================");
  console.log(`VERIFICATION SUMMARY: ${verifiedCount} / ${TARGET_AGENTS.length} agents verified on MST Testnet.`);
  console.log("============================================================");

  return verifiedCount === TARGET_AGENTS.length;
}

if (require.main === module) {
  main().then(success => {
    if (!success) process.exit(1);
  }).catch(err => {
    console.error("Verification error:", err);
    process.exit(1);
  });
}

module.exports = { main, TARGET_AGENTS };
