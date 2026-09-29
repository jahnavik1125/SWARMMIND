const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function verifyChallengesOnChain(swarmId = 1) {
  console.log("============================================================");
  console.log(`      SWARMMIND ON-CHAIN CHALLENGE MARKET VERIFICATION       `);
  console.log("============================================================");

  const deployedPath = path.join(__dirname, "..", "deployed-contracts.json");
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const coreAddress = deployed.contracts.SwarmMindCore.address;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const coreArtifact = getArtifact(path.join("SwarmMindCore.sol", "SwarmMindCore.json"));
  const core = new ethers.Contract(coreAddress, coreArtifact.abi, provider);

  const swarm = await core.getSwarm(swarmId);
  const stateNames = ["Created", "AgentsSelected", "Revealing", "Resolved", "Settled", "Cancelled"];
  const challengeStatusNames = ["Pending", "Upheld", "Dismissed"];

  console.log(`Swarm ID             : #${swarm.swarmId}`);
  console.log(`Current Swarm State  : ${swarm.state} (${stateNames[Number(swarm.state)]})`);
  console.log(`Min Challenge Bond   : ${ethers.formatEther(swarm.minChallengeBond)} MSTC`);

  // Query swarmChallengeIds
  const challengeIds = await core.getSwarmChallenges(swarmId);
  console.log(`Total Challenges     : ${challengeIds.length}`);

  // Query ChallengeCreated events
  const filter = core.filters.ChallengeCreated(null, swarmId);
  const events = await core.queryFilter(filter, 5786500);

  const eventMap = {};
  events.forEach(e => {
    eventMap[e.args.challengeId.toString()] = {
      txHash: e.transactionHash,
      blockNumber: e.blockNumber
    };
  });

  const agentNames = {
    "0x4f593aa368b69c663a279a652ffdce8e2a7da9526492ac357472105aa758162b": "WEATHER_ALPHA",
    "0x2bb519c2d3835d6116adade05fdda3b9ddf2f4ef94bd343af59a317aee0cb1f4": "WEATHER_BETA",
    "0x2d9cbf004444d64e839bc520559f8047edd707a24ee15171f56648797edad560": "WEATHER_GAMMA"
  };

  if (challengeIds.length === 0) {
    console.log("\nNo challenges have been registered on-chain yet for Swarm #1.");
    console.log("Status: Challenge market open and active during Revealing state.");
  } else {
    for (let i = 0; i < challengeIds.length; i++) {
      const cId = challengeIds[i];
      const ch = await core.getChallenge(cId);
      const ev = eventMap[cId.toString()];
      const targetName = agentNames[ch.targetAgentId.toLowerCase()] || ch.targetAgentId;

      console.log(`\n--- Challenge #${ch.challengeId} ---`);
      console.log(`  Challenger         : ${ch.challenger}`);
      console.log(`  Target Agent       : ${targetName} (${ch.targetAgentId})`);
      console.log(`  Challenge Bond     : ${ethers.formatEther(ch.challengeBond)} MSTC`);
      console.log(`  Evidence Reference : ${ch.evidenceHash}`);
      console.log(`  Challenge State    : ${ch.status} (${challengeStatusNames[Number(ch.status)]})`);
      console.log(`  Timestamp          : ${new Date(Number(ch.createdAt) * 1000).toISOString()}`);
      if (ev) {
        console.log(`  Transaction Hash   : ${ev.txHash}`);
        console.log(`  Block Number       : ${ev.blockNumber}`);
        console.log(`  MSTScan Link       : https://testnet.mstscan.com/tx/${ev.txHash}`);
      }
    }
  }

  console.log("\n============================================================");
  console.log(`CHALLENGE MARKET SUMMARY: ${challengeIds.length} challenges on-chain.`);
  console.log("============================================================\n");

  return {
    swarmId: Number(swarm.swarmId),
    state: Number(swarm.state),
    stateName: stateNames[Number(swarm.state)],
    minChallengeBond: ethers.formatEther(swarm.minChallengeBond),
    challengeCount: challengeIds.length,
    challenges: challengeIds.map(id => Number(id))
  };
}

if (require.main === module) {
  verifyChallengesOnChain().catch(err => {
    console.error("Verification error:", err);
    process.exit(1);
  });
}

module.exports = { verifyChallengesOnChain };
