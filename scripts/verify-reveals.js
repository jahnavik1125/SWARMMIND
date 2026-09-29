const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function verifyRevealsOnChain(swarmId = 1) {
  console.log("============================================================");
  console.log(`     SWARMMIND ON-CHAIN REVEAL & CRYPTOGRAPHIC VERIFICATION  `);
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
  const currentBlock = await provider.getBlock("latest");
  const currentTimestamp = currentBlock.timestamp;
  const revealDeadline = Number(swarm.revealDeadline);

  console.log(`Swarm ID             : #${swarm.swarmId}`);
  console.log(`Current State        : ${swarm.state} (${stateNames[Number(swarm.state)]})`);
  console.log(`Current Timestamp    : ${new Date(currentTimestamp * 1000).toISOString()}`);
  console.log(`Reveal Deadline      : ${new Date(revealDeadline * 1000).toISOString()}`);
  console.log(`Within Deadline      : ${currentTimestamp <= revealDeadline ? "YES ✓" : "EXPIRED ✗"}`);
  console.log(`Total Bonded Amount  : ${ethers.formatEther(swarm.totalBonded)} MSTC`);

  // Load salt storage to perform cryptographic verification
  const storagePath = path.join(__dirname, "..", "secure-storage", `commitments-swarm-${swarmId}.json`);
  let storedCommitments = null;
  if (fs.existsSync(storagePath)) {
    storedCommitments = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  }

  // Query AgentRevealed events from blockchain
  const filter = core.filters.AgentRevealed(swarmId);
  const events = await core.queryFilter(filter, 5786500);

  const eventMap = {};
  events.forEach(e => {
    eventMap[e.args.agentId.toLowerCase()] = {
      predictionValue: e.args.predictionValue,
      confidence: Number(e.args.confidence),
      txHash: e.transactionHash,
      blockNumber: e.blockNumber
    };
  });

  console.log(`\nSelected Agents (${selectedAgents.length}):`);
  let revealedCount = 0;
  let allCryptographicPass = true;

  // Map known agent IDs to names
  const agentNames = {
    "0x4f593aa368b69c663a279a652ffdce8e2a7da9526492ac357472105aa758162b": "WEATHER_ALPHA",
    "0x2bb519c2d3835d6116adade05fdda3b9ddf2f4ef94bd343af59a317aee0cb1f4": "WEATHER_BETA",
    "0x2d9cbf004444d64e839bc520559f8047edd707a24ee15171f56648797edad560": "WEATHER_GAMMA"
  };

  for (let i = 0; i < selectedAgents.length; i++) {
    const aId = selectedAgents[i];
    const name = agentNames[aId.toLowerCase()] || `AGENT_${i + 1}`;
    const pred = await core.getPrediction(swarmId, aId);
    const ev = eventMap[aId.toLowerCase()];

    console.log(`\n--- [${i + 1}/${selectedAgents.length}] ${name} ---`);
    console.log(`  Agent ID            : ${aId}`);
    console.log(`  Commitment Hash     : ${pred.commitmentHash}`);
    console.log(`  Locked Bond Status  : ${ethers.formatEther(pred.bondAmount)} MSTC (LOCKED IN ESCROW)`);
    console.log(`  Revealed On-Chain   : ${pred.revealed ? "YES ✓" : "NO 🔒 [HIDDEN]"}`);

    if (pred.revealed) {
      revealedCount++;
      const predText = Number(pred.predictionValue) === 1 ? "YES (Rain >= 0.5mm)" : "NO (Rain < 0.5mm)";
      console.log(`  Prediction Value    : ${pred.predictionValue} (${predText})`);
      console.log(`  Confidence          : ${Number(pred.confidence)} bps (${(Number(pred.confidence) / 100).toFixed(1)}%)`);
      console.log(`  Revealed At (Block) : ${new Date(Number(pred.revealedAt) * 1000).toISOString()}`);

      if (ev) {
        console.log(`  Reveal Tx Hash      : ${ev.txHash}`);
        console.log(`  Block Number        : ${ev.blockNumber}`);
        console.log(`  MSTScan Link        : https://testnet.mstscan.com/tx/${ev.txHash}`);
      }

      // Cryptographic verification against off-chain salt
      let salt = null;
      if (storedCommitments && storedCommitments.commitments) {
        for (const c of Object.values(storedCommitments.commitments)) {
          if (c.agentId.toLowerCase() === aId.toLowerCase()) {
            salt = c.salt;
            break;
          }
        }
      }

      if (salt) {
        const recomputedOnChain = await core.computeCommitmentHash(
          swarmId,
          aId,
          pred.predictionValue,
          pred.confidence,
          salt
        );

        const recomputedLocal = ethers.solidityPackedKeccak256(
          ["uint256", "bytes32", "int256", "uint256", "bytes32"],
          [swarmId, aId, pred.predictionValue, pred.confidence, salt]
        );

        const isMatch = recomputedOnChain === pred.commitmentHash && recomputedLocal === pred.commitmentHash;
        console.log(`  Recomputed Salt Hash: ${recomputedOnChain}`);
        console.log(`  Commitment Match    : ${isMatch ? "MATCH ✓ (CRYPTOGRAPHICALLY VERIFIED)" : "MISMATCH ✗"}`);

        if (!isMatch) {
          allCryptographicPass = false;
        }
      } else {
        console.log(`  Commitment Match    : Salt not found in local vault`);
        allCryptographicPass = false;
      }
    } else {
      console.log(`  Prediction          : [HIDDEN UNTIL REVEAL]`);
      console.log(`  Confidence          : [HIDDEN UNTIL REVEAL]`);
      console.log(`  Reveal Transaction  : PENDING`);
    }
  }

  console.log("\n============================================================");
  console.log(`REVEAL SUMMARY: ${revealedCount} / ${selectedAgents.length} REVEALED`);
  if (revealedCount === selectedAgents.length) {
    console.log(`Cryptographic verification: ${allCryptographicPass ? "PASS ✓" : "FAIL ✗"}`);
  } else {
    console.log(`Reveal Phase In Progress (${revealedCount}/${selectedAgents.length} completed).`);
  }
  console.log(`Current Swarm State: ${stateNames[Number(swarm.state)]}`);
  console.log("============================================================\n");

  return {
    swarmId: Number(swarm.swarmId),
    state: Number(swarm.state),
    stateName: stateNames[Number(swarm.state)],
    selectedCount: selectedAgents.length,
    revealedCount: revealedCount,
    allRevealed: revealedCount === selectedAgents.length,
    cryptographicVerification: allCryptographicPass
  };
}

if (require.main === module) {
  verifyRevealsOnChain().catch(err => {
    console.error("Verification error:", err);
    process.exit(1);
  });
}

module.exports = { verifyRevealsOnChain };
