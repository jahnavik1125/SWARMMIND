const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const PORT = process.env.PORT || 3333;
const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

const { compileProblem } = require("../services/problem-compiler.js");
const { discoverAgents } = require("../services/agent-registry-client.js");
const {
  generateAndStoreCommitments,
  getSanitizedCommitments,
  updateCommitReceipt,
  getRevealPayload,
  updateRevealReceipt
} = require("../services/commitment-store.js");
const { collectWeatherOutcome } = require("../services/outcome-collector.js");
const db = require("../services/database.js");
const { selectAgentsForQuestion } = require("../services/agent-router.js");
const { runSwarmMind } = require("../services/swarm-coordinator.js");
const { resolveSwarmOutcome } = require("../services/outcome-service.js");

// Paths
const ARTIFACT_DIR = path.join(__dirname, "..", "artifacts", "contracts");
const DEPLOYED_FILE = path.join(__dirname, "..", "deployed-contracts.json");
const HTML_FILE = path.join(__dirname, "..", "frontend", "deploy", "index.html");

function getArtifact(contractName) {
  let artifactPath = "";
  if (contractName === "MVPControlledResolver") {
    artifactPath = path.join(ARTIFACT_DIR, "resolvers", "MVPControlledResolver.sol", "MVPControlledResolver.json");
  } else if (contractName === "SwarmMindCore") {
    artifactPath = path.join(ARTIFACT_DIR, "SwarmMindCore.sol", "SwarmMindCore.json");
  } else if (contractName === "IOutcomeResolver") {
    artifactPath = path.join(ARTIFACT_DIR, "interfaces", "IOutcomeResolver.sol", "IOutcomeResolver.json");
  }

  if (fs.existsSync(artifactPath)) {
    const raw = fs.readFileSync(artifactPath, "utf8");
    const json = JSON.parse(raw);
    return {
      contractName: json.contractName,
      abi: json.abi,
      bytecode: json.bytecode,
    };
  }
  return null;
}

// Server
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Serve Frontend UI
  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (fs.existsSync(HTML_FILE)) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      });
      res.end(fs.readFileSync(HTML_FILE, "utf8"));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Deploy UI not found.");
    }
    return;
  }

  // Network Status API
  if (url.pathname === "/api/network-status" && req.method === "GET") {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const network = await provider.getNetwork();
      const blockNumber = await provider.getBlockNumber();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "online",
        rpcUrl: RPC_URL,
        chainId: Number(network.chainId),
        blockNumber: Number(blockNumber),
        targetChainId: TARGET_CHAIN_ID,
        isMatchingChain: Number(network.chainId) === TARGET_CHAIN_ID
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "error",
        message: err.message,
        rpcUrl: RPC_URL
      }));
    }
    return;
  }

  // Contract Artifact API
  if (url.pathname.startsWith("/api/artifact/") && req.method === "GET") {
    const contractName = url.pathname.replace("/api/artifact/", "");
    const artifact = getArtifact(contractName);
    if (artifact) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(artifact));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Artifact ${contractName} not found` }));
    }
    return;
  }

  // Save Deployment API
  if (url.pathname === "/api/save-deployment" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);

        // Validation
        if (!data.contracts || !data.contracts.SwarmMindCore || !data.contracts.MVPControlledResolver) {
          throw new Error("Invalid deployment payload");
        }

        const deploymentMetadata = {
          network: "mstTestnet",
          chainId: TARGET_CHAIN_ID,
          rpcUrl: RPC_URL,
          deployedAt: new Date().toISOString(),
          deployer: data.deployer,
          contracts: {
            MVPControlledResolver: {
              address: data.contracts.MVPControlledResolver.address,
              txHash: data.contracts.MVPControlledResolver.txHash,
              blockNumber: data.contracts.MVPControlledResolver.blockNumber,
              explorerUrl: `https://testnet.mstscan.com/address/${data.contracts.MVPControlledResolver.address}`,
              txExplorerUrl: `https://testnet.mstscan.com/tx/${data.contracts.MVPControlledResolver.txHash}`,
            },
            SwarmMindCore: {
              address: data.contracts.SwarmMindCore.address,
              txHash: data.contracts.SwarmMindCore.txHash,
              blockNumber: data.contracts.SwarmMindCore.blockNumber,
              explorerUrl: `https://testnet.mstscan.com/address/${data.contracts.SwarmMindCore.address}`,
              txExplorerUrl: `https://testnet.mstscan.com/tx/${data.contracts.SwarmMindCore.txHash}`,
            },
          },
        };

        fs.writeFileSync(DEPLOYED_FILE, JSON.stringify(deploymentMetadata, null, 2));
        console.log(`Saved deployment info to ${DEPLOYED_FILE}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, metadata: deploymentMetadata }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Save Agent Registration API
  if (url.pathname === "/api/save-agent-registration" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const registeredFile = path.join(__dirname, "..", "registered-agents.json");
        let existing = {};
        if (fs.existsSync(registeredFile)) {
          existing = JSON.parse(fs.readFileSync(registeredFile, "utf8"));
        }
        if (!existing.agents) existing.agents = {};

        existing.agents[data.agentName] = {
          agentId: data.agentId,
          capability: data.capability,
          metadataUri: data.metadataUri,
          txHash: data.txHash,
          blockNumber: data.blockNumber,
          owner: data.owner,
          registeredAt: new Date().toISOString(),
          explorerUrl: `https://testnet.mstscan.com/tx/${data.txHash}`
        };

        fs.writeFileSync(registeredFile, JSON.stringify(existing, null, 2));
        console.log(`Saved agent ${data.agentName} to ${registeredFile}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, agents: existing.agents }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Agent Status Query API
  if (url.pathname === "/api/agent-status" && req.method === "GET") {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const deployedData = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
      const coreAddr = deployedData.contracts.SwarmMindCore.address;
      const coreArtifact = getArtifact("SwarmMindCore");
      const coreContract = new ethers.Contract(coreAddr, coreArtifact.abi, provider);

      const targetAgents = [
        { name: "WEATHER_ALPHA", id: ethers.id("WEATHER_ALPHA"), cap: "WEATHER" },
        { name: "WEATHER_BETA", id: ethers.id("WEATHER_BETA"), cap: "WEATHER" },
        { name: "WEATHER_GAMMA", id: ethers.id("WEATHER_GAMMA"), cap: "WEATHER" }
      ];

      const statuses = {};
      for (const a of targetAgents) {
        try {
          const agentData = await coreContract.getAgent(a.id);
          const rep = await coreContract.getAgentReputation(a.id, a.cap);
          statuses[a.name] = {
            registered: agentData.registeredAt > 0,
            owner: agentData.owner,
            capability: agentData.capability,
            active: agentData.active,
            reputation: Number(rep),
            registeredAt: Number(agentData.registeredAt)
          };
        } catch {
          statuses[a.name] = { registered: false };
        }
      }

      const allIds = await coreContract.getAllAgentIds();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        totalRegisteredOnChain: allIds.length,
        agents: statuses
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Compile Problem API
  if (url.pathname === "/api/compile-problem" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { question } = JSON.parse(body);
        const compiled = compileProblem(question);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(compiled));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Discover Agents API
  if (url.pathname === "/api/discover-agents" && req.method === "GET") {
    try {
      const capability = url.searchParams.get("capability") || "WEATHER";
      const result = await discoverAgents(capability);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Save Swarm API (Creation & Selection receipts)
  if (url.pathname === "/api/save-swarm" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const swarmsFile = path.join(__dirname, "..", "swarms.json");
        let existing = { swarms: [] };
        if (fs.existsSync(swarmsFile)) {
          existing = JSON.parse(fs.readFileSync(swarmsFile, "utf8"));
        }

        const existingIdx = existing.swarms.findIndex(s => s.swarmId === payload.swarmId);
        if (existingIdx >= 0) {
          existing.swarms[existingIdx] = { ...existing.swarms[existingIdx], ...payload, updatedAt: new Date().toISOString() };
        } else {
          existing.swarms.push({ ...payload, createdAt: new Date().toISOString() });
        }

        fs.writeFileSync(swarmsFile, JSON.stringify(existing, null, 2));
        console.log(`Saved swarm #${payload.swarmId} to ${swarmsFile}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, swarm: payload }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Get Swarms List API
  if (url.pathname === "/api/swarms" && req.method === "GET") {
    try {
      const swarmsFile = path.join(__dirname, "..", "swarms.json");
      if (fs.existsSync(swarmsFile)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fs.readFileSync(swarmsFile, "utf8"));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ swarms: [] }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get On-Chain Swarm State API
  if (url.pathname.startsWith("/api/swarm-onchain/") && req.method === "GET") {
    try {
      const swarmId = parseInt(url.pathname.replace("/api/swarm-onchain/", ""));
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const deployedData = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
      const coreAddr = deployedData.contracts.SwarmMindCore.address;
      const coreArtifact = getArtifact("SwarmMindCore");
      const coreContract = new ethers.Contract(coreAddr, coreArtifact.abi, provider);

      const swarm = await coreContract.getSwarm(swarmId);
      const selected = await coreContract.getSwarmSelectedAgents(swarmId);

      const swarmStateNames = ["Created", "AgentsSelected", "Revealing", "Resolved", "Settled", "Cancelled"];

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        swarmId: Number(swarm.swarmId),
        creator: swarm.creator,
        questionHash: swarm.questionHash,
        requiredCapability: swarm.requiredCapability,
        bounty: ethers.formatEther(swarm.bounty),
        commitDeadline: Number(swarm.commitDeadline),
        revealDeadline: Number(swarm.revealDeadline),
        requiredAgentCount: Number(swarm.requiredAgentCount),
        minBond: ethers.formatEther(swarm.minBond),
        minChallengeBond: ethers.formatEther(swarm.minChallengeBond),
        outcomeResolver: swarm.outcomeResolver,
        state: Number(swarm.state),
        stateName: swarmStateNames[Number(swarm.state)] || "Unknown",
        selectedAgents: selected,
        createdAt: Number(swarm.createdAt)
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Generate Agent Commitments API
  if (url.pathname === "/api/generate-commitments" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { swarmId = 1, question = "Will it rain in Chennai tomorrow?" } = JSON.parse(body || "{}");
        await generateAndStoreCommitments(swarmId, question);
        const sanitized = getSanitizedCommitments(swarmId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sanitized));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Get Sanitized Commitments API (hides prediction and salt during commit phase)
  if (url.pathname === "/api/commitments" && req.method === "GET") {
    try {
      const swarmId = parseInt(url.searchParams.get("swarmId") || "1");
      const sanitized = getSanitizedCommitments(swarmId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sanitized));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Save Commit Receipt API
  if (url.pathname === "/api/save-commit-receipt" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { swarmId = 1, agentKey, txHash, blockNumber } = JSON.parse(body);
        const updated = updateCommitReceipt(swarmId, agentKey, txHash, blockNumber);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: updated }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Get Reveal Payload for an Agent (Pre-verifies hash before serving)
  if (url.pathname === "/api/reveal-payload" && req.method === "GET") {
    try {
      const swarmId = parseInt(url.searchParams.get("swarmId") || "1");
      const agentKey = url.searchParams.get("agentKey");
      if (!agentKey) throw new Error("Missing agentKey parameter");

      // Verify on-chain deadline first
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const deployedData = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
      const coreAddr = deployedData.contracts.SwarmMindCore.address;
      const coreArtifact = getArtifact("SwarmMindCore");
      const coreContract = new ethers.Contract(coreAddr, coreArtifact.abi, provider);

      const swarm = await coreContract.getSwarm(swarmId);
      const currentBlock = await provider.getBlock("latest");
      if (currentBlock.timestamp > Number(swarm.revealDeadline)) {
        throw new Error("Reveal deadline has passed on-chain!");
      }

      const payload = getRevealPayload(swarmId, agentKey);

      // Verify against on-chain commitment hash
      const onchainPred = await coreContract.getPrediction(swarmId, payload.agentId);
      if (!onchainPred.committed) {
        throw new Error(`Agent ${agentKey} is not committed on-chain`);
      }
      if (payload.commitmentHash.toLowerCase() !== onchainPred.commitmentHash.toLowerCase()) {
        throw new Error(
          `FATAL: Local computed hash does not match on-chain commitment hash! Local: ${payload.commitmentHash}, OnChain: ${onchainPred.commitmentHash}`
        );
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Save Reveal Receipt API
  if (url.pathname === "/api/save-reveal-receipt" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { swarmId = 1, agentKey, txHash, blockNumber } = JSON.parse(body);
        const updated = updateRevealReceipt(swarmId, agentKey, txHash, blockNumber);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: updated }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Live On-Chain Reveals Query (Strictly hides unrevealed predictions)
  if (url.pathname === "/api/reveals-onchain" && req.method === "GET") {
    try {
      const swarmId = parseInt(url.searchParams.get("swarmId") || "1");
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const deployedData = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
      const coreAddr = deployedData.contracts.SwarmMindCore.address;
      const coreArtifact = getArtifact("SwarmMindCore");
      const coreContract = new ethers.Contract(coreAddr, coreArtifact.abi, provider);

      const swarm = await coreContract.getSwarm(swarmId);
      const block = await provider.getBlock("latest");

      const agentMap = {
        WEATHER_ALPHA: "0x4f593aa368b69c663a279a652ffdce8e2a7da9526492ac357472105aa758162b",
        WEATHER_BETA: "0x2bb519c2d3835d6116adade05fdda3b9ddf2f4ef94bd343af59a317aee0cb1f4",
        WEATHER_GAMMA: "0x2d9cbf004444d64e839bc520559f8047edd707a24ee15171f56648797edad560"
      };

      const storagePath = path.join(__dirname, "..", "secure-storage", `commitments-swarm-${swarmId}.json`);
      let storedCommitments = null;
      if (fs.existsSync(storagePath)) {
        storedCommitments = JSON.parse(fs.readFileSync(storagePath, "utf8"));
      }

      const results = {};
      let allRevealed = true;

      for (const [key, id] of Object.entries(agentMap)) {
        const p = await coreContract.getPrediction(swarmId, id);
        if (!p.revealed) {
          allRevealed = false;
          results[key] = {
            agentId: id,
            committed: p.committed,
            revealed: false,
            prediction: "[HIDDEN UNTIL REVEAL]",
            confidence: "[HIDDEN UNTIL REVEAL]",
            commitmentHash: p.commitmentHash,
            bondAmount: ethers.formatEther(p.bondAmount),
            verified: false
          };
        } else {
          // Cryptographically recompute verification
          const stored = storedCommitments?.commitments?.[key];
          let verified = false;
          if (stored?.salt) {
            const recomputed = await coreContract.computeCommitmentHash(
              swarmId,
              id,
              p.predictionValue,
              p.confidence,
              stored.salt
            );
            verified = (recomputed.toLowerCase() === p.commitmentHash.toLowerCase());
          }

          results[key] = {
            agentId: id,
            committed: p.committed,
            revealed: true,
            predictionValue: Number(p.predictionValue),
            predictionText: Number(p.predictionValue) === 1 ? "YES" : "NO",
            confidence: Number(p.confidence),
            confidenceFormatted: `${(Number(p.confidence) / 100).toFixed(1)}%`,
            commitmentHash: p.commitmentHash,
            bondAmount: ethers.formatEther(p.bondAmount),
            revealedAt: Number(p.revealedAt),
            verified: verified,
            txHash: stored?.revealTxHash || null,
            blockNumber: stored?.revealBlockNumber || null
          };
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        swarmId,
        state: Number(swarm.state),
        currentTimestamp: block.timestamp,
        revealDeadline: Number(swarm.revealDeadline),
        withinDeadline: block.timestamp <= Number(swarm.revealDeadline),
        allRevealed,
        agents: results
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get Challenge Evidence Package API
  if (url.pathname === "/api/challenge-evidence" && req.method === "GET") {
    try {
      const swarmId = parseInt(url.searchParams.get("swarmId") || "1");
      const evidencePath = path.join(__dirname, "..", "secure-storage", `challenge-evidence-swarm-${swarmId}.json`);
      if (!fs.existsSync(evidencePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Evidence package not found" }));
        return;
      }
      const data = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Save Challenge Receipt API
  if (url.pathname === "/api/save-challenge-receipt" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const { swarmId = 1, challengeId, targetAgentId, challenger, txHash, blockNumber, evidenceHash, challengeBond } = payload;

        const swarmsFile = path.join(__dirname, "..", "swarms.json");
        if (fs.existsSync(swarmsFile)) {
          const swarmsData = JSON.parse(fs.readFileSync(swarmsFile, "utf8"));
          const sw = swarmsData.swarms.find(s => s.swarmId === swarmId);
          if (sw) {
            if (!sw.challenges) sw.challenges = [];
            sw.challenges.push({
              challengeId,
              targetAgentId,
              challenger,
              txHash,
              blockNumber,
              evidenceHash,
              challengeBond,
              createdAt: new Date().toISOString()
            });
            fs.writeFileSync(swarmsFile, JSON.stringify(swarmsData, null, 2));
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, challengeId }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Live On-Chain Challenges Query
  if (url.pathname === "/api/challenges-onchain" && req.method === "GET") {
    try {
      const swarmId = parseInt(url.searchParams.get("swarmId") || "1");
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const deployedData = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
      const coreAddr = deployedData.contracts.SwarmMindCore.address;
      const coreArtifact = getArtifact("SwarmMindCore");
      const coreContract = new ethers.Contract(coreAddr, coreArtifact.abi, provider);

      const swarm = await coreContract.getSwarm(swarmId);
      const cIds = await coreContract.getSwarmChallenges(swarmId);

      const filter = coreContract.filters.ChallengeCreated(null, swarmId);
      const events = await coreContract.queryFilter(filter, 5786500);
      const eventMap = {};
      events.forEach(e => {
        eventMap[e.args.challengeId.toString()] = {
          txHash: e.transactionHash,
          blockNumber: e.blockNumber
        };
      });

      const challengeStatusNames = ["Pending", "Upheld", "Dismissed"];
      const challenges = [];

      for (const id of cIds) {
        const ch = await coreContract.getChallenge(id);
        const ev = eventMap[id.toString()];
        challenges.push({
          challengeId: Number(ch.challengeId),
          swarmId: Number(ch.swarmId),
          targetAgentId: ch.targetAgentId,
          challenger: ch.challenger,
          challengeBond: ethers.formatEther(ch.challengeBond),
          evidenceHash: ch.evidenceHash,
          status: Number(ch.status),
          statusName: challengeStatusNames[Number(ch.status)] || "Unknown",
          createdAt: Number(ch.createdAt),
          txHash: ev?.txHash || null,
          blockNumber: ev?.blockNumber || null
        });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        swarmId,
        minChallengeBond: ethers.formatEther(swarm.minChallengeBond),
        count: challenges.length,
        challenges
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Outcome Status & Resolution Endpoint
  if (url.pathname === "/api/outcome-status" && req.method === "GET") {
    try {
      const swarmId = parseInt(url.searchParams.get("swarmId") || "1");
      const targetDate = url.searchParams.get("targetDate") || "2026-09-29";
      const outcomeData = await collectWeatherOutcome(swarmId, targetDate);

      // Fetch live on-chain status
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const deployedData = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
      const coreAddr = deployedData.contracts.SwarmMindCore.address;
      const resolverAddr = deployedData.contracts.MVPControlledResolver.address;
      const coreArtifact = getArtifact("SwarmMindCore");
      const resolverArtifact = getArtifact("MVPControlledResolver");
      const coreContract = new ethers.Contract(coreAddr, coreArtifact.abi, provider);
      const resolverContract = new ethers.Contract(resolverAddr, resolverArtifact.abi, provider);

      const swarm = await coreContract.getSwarm(swarmId);
      const isResolved = await resolverContract.isResolved(swarmId);
      let resolverOutcome = null;
      if (isResolved) {
        resolverOutcome = await resolverContract.getOutcome(swarmId);
      }

      const balance = await provider.getBalance(coreAddr);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ...outcomeData,
        onChain: {
          swarmId,
          coreAddress: coreAddr,
          resolverAddress: resolverAddr,
          state: Number(swarm.state),
          stateName: ["Created", "AgentsSelected", "Revealing", "Resolved", "Settled", "Cancelled"][Number(swarm.state)],
          isResolvedOnChain: isResolved,
          resolverOutcome: resolverOutcome !== null ? Number(resolverOutcome) : null,
          bounty: ethers.formatEther(swarm.bounty),
          escrowBalance: ethers.formatEther(balance)
        }
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Verification API
  if (url.pathname === "/api/verify" && req.method === "POST") {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      if (!fs.existsSync(DEPLOYED_FILE)) {
        throw new Error("No deployment file found at deployed-contracts.json");
      }

      const deployedData = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
      const resolverAddr = deployedData.contracts.MVPControlledResolver.address;
      const coreAddr = deployedData.contracts.SwarmMindCore.address;

      // 1. Verify bytecodes on MST Testnet
      const resolverCode = await provider.getCode(resolverAddr);
      const coreCode = await provider.getCode(coreAddr);

      const isResolverDeployed = resolverCode !== "0x" && resolverCode.length > 2;
      const isCoreDeployed = coreCode !== "0x" && coreCode.length > 2;

      // 2. Read-only calls on SwarmMindCore
      const coreArtifact = getArtifact("SwarmMindCore");
      const coreContract = new ethers.Contract(coreAddr, coreArtifact.abi, provider);

      const maxReputation = await coreContract.MAX_REPUTATION();
      const baseWeight = await coreContract.BASE_REPUTATION_WEIGHT();
      const nextSwarmId = await coreContract.nextSwarmId();
      const coreOwner = await coreContract.owner();

      // 3. Read-only calls on MVPControlledResolver
      const resolverArtifact = getArtifact("MVPControlledResolver");
      const resolverContract = new ethers.Contract(resolverAddr, resolverArtifact.abi, provider);
      const resolverOwner = await resolverContract.owner();
      const isResolvedSample = await resolverContract.isResolved(1);

      const result = {
        verified: isResolverDeployed && isCoreDeployed,
        network: "mstTestnet",
        chainId: TARGET_CHAIN_ID,
        checks: {
          resolverBytecodePresent: isResolverDeployed,
          resolverBytecodeBytes: resolverCode.length / 2 - 1,
          coreBytecodePresent: isCoreDeployed,
          coreBytecodeBytes: coreCode.length / 2 - 1,
          coreOwnerMatches: coreOwner,
          resolverOwnerMatches: resolverOwner,
          maxReputation: Number(maxReputation),
          baseWeight: Number(baseWeight),
          nextSwarmId: Number(nextSwarmId),
          resolverIsResolvedSample: isResolvedSample
        }
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ verified: false, error: err.message }));
    }
    return;
  }

  // =============================================================
  //     SWARMMIND GENERAL MULTI-AGENT PLATFORM API ENDPOINTS
  // =============================================================

  // 1. Get All Agents in Registry
  if (url.pathname === "/api/platform/agents" && req.method === "GET") {
    const agents = db.getAgents();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, count: agents.length, agents }));
    return;
  }

  // 2. Get Single Agent Profile
  if (url.pathname.startsWith("/api/platform/agent/") && req.method === "GET") {
    const agentId = url.pathname.replace("/api/platform/agent/", "");
    const agent = db.getAgentById(agentId);
    if (agent) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, agent }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: `Agent ${agentId} not found` }));
    }
    return;
  }

  // 3. Get Data Sources Registry
  if (url.pathname === "/api/platform/data-sources" && req.method === "GET") {
    const dataSources = db.getDataSources();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, count: dataSources.length, dataSources }));
    return;
  }

  // 4. Analyze Question & Select Agents (Router)
  if (url.pathname === "/api/platform/analyze-question" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const result = selectAgentsForQuestion(data.question);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 5. Run Full SwarmMind Lifecycle
  if (url.pathname === "/api/platform/run-swarm" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        console.log(`[SWARMMIND] Processing Question: "${data.question}"`);
        const swarmResult = await runSwarmMind(data.question);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, swarm: swarmResult }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 6. Get All Swarms (Prediction History)
  if (url.pathname === "/api/platform/swarms" && req.method === "GET") {
    const swarms = db.getSwarms();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, count: swarms.length, swarms }));
    return;
  }

  // 7. Get Single Swarm Details
  if (url.pathname.startsWith("/api/platform/swarm/") && req.method === "GET") {
    const sId = url.pathname.replace("/api/platform/swarm/", "");
    const swarm = db.getSwarmById(sId);
    if (swarm) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, swarm }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: `Swarm ${sId} not found` }));
    }
    return;
  }

  // 8. Resolve Swarm Outcome & Update Reputation
  if (url.pathname === "/api/platform/resolve-swarm" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const result = resolveSwarmOutcome(
          data.swarmId,
          Number(data.outcomeValue),
          data.groundTruthEvidence || "Verified against empirical measurement."
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 9. Reset DB to Default
  if (url.pathname === "/api/platform/reset-db" && req.method === "POST") {
    const freshDb = db.resetToDefault();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Database reset to defaults" }));
    return;
  }

  // 404 Fallback
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`  SwarmMind BridgeKey Deployment Tool Active    `);
  console.log(`=================================================`);
  console.log(`URL             : http://localhost:${PORT}`);
  console.log(`Target Network  : MST Testnet (Chain ID: ${TARGET_CHAIN_ID})`);
  console.log(`RPC Endpoint    : ${RPC_URL}`);
  console.log(`Ready for BridgeKey browser wallet connection.`);
  console.log(`=================================================`);
});
