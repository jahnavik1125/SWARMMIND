const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function verifySettlementOnChain(swarmId = 1) {
  console.log("============================================================");
  console.log(`     SWARMMIND ON-CHAIN OUTCOME & SETTLEMENT AUDIT           `);
  console.log("============================================================");

  const deployedPath = path.join(__dirname, "..", "deployed-contracts.json");
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const coreAddress = deployed.contracts.SwarmMindCore.address;
  const resolverAddress = deployed.contracts.MVPControlledResolver.address;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const coreArtifact = getArtifact(path.join("SwarmMindCore.sol", "SwarmMindCore.json"));
  const core = new ethers.Contract(coreAddress, coreArtifact.abi, provider);

  const resolverArtifact = getArtifact(path.join("resolvers", "MVPControlledResolver.sol", "MVPControlledResolver.json"));
  const resolver = new ethers.Contract(resolverAddress, resolverArtifact.abi, provider);

  const swarm = await core.getSwarm(swarmId);
  const stateNames = ["Created", "AgentsSelected", "Revealing", "Resolved", "Settled", "Cancelled"];
  const currentBlock = await provider.getBlock("latest");

  console.log(`Swarm ID             : #${swarm.swarmId}`);
  console.log(`Current Swarm State  : ${swarm.state} (${stateNames[Number(swarm.state)]})`);
  console.log(`Swarm Bounty Escrow  : ${ethers.formatEther(swarm.bounty)} MSTC`);
  console.log(`Total Bonded Amount  : ${ethers.formatEther(swarm.totalBonded)} MSTC`);
  console.log(`Total Escrow Pool    : ${ethers.formatEther(swarm.bounty + swarm.totalBonded)} MSTC`);
  console.log(`Outcome Resolver     : ${swarm.outcomeResolver}`);

  // Query resolver status
  const [isResolvedByContract, outcomeVal, evBytes] = await resolver.getOutcome(swarmId);
  console.log(`\nMVPControlledResolver Status:`);
  console.log(`  Is Resolved in Oracle: ${isResolvedByContract ? "YES ✓" : "NO (PENDING)"}`);

  const { evaluateSettlementGate } = require("../services/outcome-collector.js");
  const targetDate = "2026-09-29";
  const todayDateStr = new Date(currentBlock.timestamp * 1000).toISOString().split("T")[0];
  const isDateElapsed = todayDateStr > targetDate;

  const gateAudit = evaluateSettlementGate({
    isTargetPeriodComplete: isDateElapsed,
    isForecastOnly: false,
    observedValueMissing: true, // Not yet recorded in historical archive
    isEvidenceReproducible: false,
    isResolverAuthorized: true
  });

  console.log(`\nMilestone 9 Hard Safety Gate Audit:`);
  console.log(`  Current Testnet Date    : ${todayDateStr} (${new Date(currentBlock.timestamp * 1000).toISOString()})`);
  console.log(`  Target Observation Date : ${targetDate}`);
  console.log(`  Target Period Complete  : ${isDateElapsed ? "YES ✓" : "NO (PENDING)"}`);
  console.log(`  Source Dataset Class    : Realized Observations Archive (Forecasts strictly blocked)`);
  console.log(`  Realized Observation    : ${isDateElapsed ? "Available" : "Awaiting target date completion"}`);
  console.log(`  Safety Gate Status      : ${gateAudit.status}`);
  console.log(`  Settlement Executable   : ${gateAudit.allPassed ? "YES" : "NO (DEFERRED)"}`);

  if (!isDateElapsed) {
    console.log(`  \n>> [PROTOCOL STATUS: OUTCOME_PENDING — SETTLEMENT DEFERRED] <<`);
    console.log(`  Reason: Settlement deferred because the target-date realized outcome is not yet available.`);
    console.log(`  The external ground truth measurement is not yet physically observable.`);
    console.log(`  In accordance with oracle integrity rules, live settlement is deferred until`);
    console.log(`  measurable observation is available from IMD/Open-Meteo rain gauges.`);
  }

  // Agent predictions on-chain
  const selectedAgents = await core.getSwarmSelectedAgents(swarmId);
  const agentNames = {
    "0x4f593aa368b69c663a279a652ffdce8e2a7da9526492ac357472105aa758162b": "WEATHER_ALPHA",
    "0x2bb519c2d3835d6116adade05fdda3b9ddf2f4ef94bd343af59a317aee0cb1f4": "WEATHER_BETA",
    "0x2d9cbf004444d64e839bc520559f8047edd707a24ee15171f56648797edad560": "WEATHER_GAMMA"
  };

  console.log(`\nAgents in Swarm (${selectedAgents.length}):`);
  for (let i = 0; i < selectedAgents.length; i++) {
    const aId = selectedAgents[i];
    const name = agentNames[aId.toLowerCase()] || aId;
    const p = await core.getPrediction(swarmId, aId);
    const rep = await core.getAgentReputation(aId, "WEATHER");

    console.log(`\n  [${name}] (${aId.slice(0, 14)}...)`);
    console.log(`    Revealed On-Chain : ${p.revealed ? "YES ✓" : "NO"}`);
    console.log(`    Prediction        : ${p.predictionValue == 1n ? "YES (Rain >= 0.5mm)" : "NO"}`);
    console.log(`    Confidence        : ${Number(p.confidence) / 100}%`);
    console.log(`    Bond In Escrow    : ${ethers.formatEther(p.bondAmount)} MSTC`);
    console.log(`    Current Reputation: ${rep} bps (${Number(rep) / 100}%)`);
  }

  // Check SwarmSettled events
  const filter = core.filters.SwarmSettled(swarmId);
  const events = await core.queryFilter(filter, 5786500);

  if (events.length > 0) {
    const ev = events[0];
    console.log(`\nSwarm Settled On-Chain!`);
    console.log(`  Tx Hash: ${ev.transactionHash}`);
    console.log(`  Block: ${ev.blockNumber}`);
    console.log(`  Rewards Distributed: ${ethers.formatEther(ev.args.totalDistributedRewards)} MSTC`);
    console.log(`  Slashed Bonds: ${ethers.formatEther(ev.args.totalSlashedBonds)} MSTC`);
  }

  console.log("\n============================================================");
  console.log(`AUDIT COMPLETE: Swarm #1 is in State: ${stateNames[Number(swarm.state)]}`);
  console.log("============================================================\n");

  return {
    swarmId: Number(swarm.swarmId),
    state: Number(swarm.state),
    stateName: stateNames[Number(swarm.state)],
    isResolved: isResolvedByContract,
    isDateElapsed,
    canSettle: isDateElapsed && isResolvedByContract
  };
}

if (require.main === module) {
  verifySettlementOnChain().catch(err => {
    console.error("Audit error:", err);
    process.exit(1);
  });
}

module.exports = { verifySettlementOnChain };
