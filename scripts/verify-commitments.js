const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function verifyCommitmentsOnChain(swarmId = 1) {
  console.log("============================================================");
  console.log(`  SWARMMIND ON-CHAIN COMMITMENT VERIFICATION (MST TESTNET)  `);
  console.log("============================================================");

  const deployedPath = path.join(__dirname, "..", "deployed-contracts.json");
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const coreAddress = deployed.contracts.SwarmMindCore.address;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const coreArtifact = getArtifact(path.join("SwarmMindCore.sol", "SwarmMindCore.json"));
  const core = new ethers.Contract(coreAddress, coreArtifact.abi, provider);

  const swarm = await core.getSwarm(swarmId);
  const selectedAgents = await core.getSwarmSelectedAgents(swarmId);

  const stateNames = ["Created", "AgentsSelected", "Revealing", "Resolved", "Settled", "Cancelled"];

  console.log(`Swarm ID             : #${swarm.swarmId}`);
  console.log(`Current State        : ${swarm.state} (${stateNames[Number(swarm.state)]})`);
  console.log(`Commit Deadline      : ${new Date(Number(swarm.commitDeadline) * 1000).toISOString()}`);
  console.log(`Reveal Deadline      : ${new Date(Number(swarm.revealDeadline) * 1000).toISOString()}`);
  console.log(`Configured Min Bond  : ${ethers.formatEther(swarm.minBond)} MSTC`);
  console.log(`Total Bonded Amount  : ${ethers.formatEther(swarm.totalBonded)} MSTC`);

  // Query AgentCommitted events from blockchain
  const filter = core.filters.AgentCommitted(swarmId);
  const events = await core.queryFilter(filter, 5786500);

  const eventMap = {};
  events.forEach(e => {
    eventMap[e.args.agentId.toLowerCase()] = {
      commitmentHash: e.args.commitmentHash,
      bondAmount: ethers.formatEther(e.args.bondAmount),
      txHash: e.transactionHash,
      blockNumber: e.blockNumber
    };
  });

  console.log(`\nSelected Agents (${selectedAgents.length}):`);
  let committedCount = 0;

  for (let i = 0; i < selectedAgents.length; i++) {
    const aId = selectedAgents[i];
    const pred = await core.getPrediction(swarmId, aId);
    const ev = eventMap[aId.toLowerCase()];

    console.log(`\nAgent ${i + 1}: ${aId}`);
    console.log(`  Committed On-Chain : ${pred.committed ? "YES ✓" : "NO ✗"}`);
    if (pred.committed) {
      committedCount++;
      console.log(`  Commitment Hash    : ${pred.commitmentHash}`);
      console.log(`  Locked Bond        : ${ethers.formatEther(pred.bondAmount)} MSTC`);
      console.log(`  Prediction (Reveal): ${pred.revealed ? pred.predictionValue : "[HIDDEN UNTIL REVEAL]"}`);
      if (ev) {
        console.log(`  Commit Tx Hash     : ${ev.txHash}`);
        console.log(`  Block Number       : ${ev.blockNumber}`);
        console.log(`  MSTScan Link       : https://testnet.mstscan.com/tx/${ev.txHash}`);
      }
    }
  }

  console.log("\n============================================================");
  console.log(`COMMITMENT SUMMARY: ${committedCount} / ${selectedAgents.length} agents committed.`);
  console.log(`Current Swarm State: ${stateNames[Number(swarm.state)]}`);
  console.log("============================================================");

  return {
    swarmId: Number(swarm.swarmId),
    state: Number(swarm.state),
    stateName: stateNames[Number(swarm.state)],
    selectedCount: selectedAgents.length,
    committedCount: committedCount,
    allCommitted: committedCount === selectedAgents.length
  };
}

if (require.main === module) {
  verifyCommitmentsOnChain().catch(err => {
    console.error("Verification error:", err);
    process.exit(1);
  });
}

module.exports = { verifyCommitmentsOnChain };
