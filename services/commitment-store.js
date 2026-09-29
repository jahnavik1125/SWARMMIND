const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");

const alphaAgent = require("../agents/weather-alpha/agent.js");
const betaAgent = require("../agents/weather-beta/agent.js");
const gammaAgent = require("../agents/weather-gamma/agent.js");

const STORAGE_DIR = path.join(__dirname, "..", "secure-storage");

function getStoragePath(swarmId = 1) {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  return path.join(STORAGE_DIR, `commitments-swarm-${swarmId}.json`);
}

/**
 * Execute real weather agents independently and compute cryptographic commitments.
 * Commitment format: keccak256(abi.encodePacked(swarmId, agentId, predictionValue, confidence, salt))
 */
async function generateAndStoreCommitments(swarmId = 1, question = "Will it rain in Chennai tomorrow?") {
  const storePath = getStoragePath(swarmId);

  // Execute independent agent services
  console.log(`Executing real agent services for question: "${question}"...`);
  const [alphaRes, betaRes, gammaRes] = await Promise.all([
    alphaAgent.predict(question),
    betaAgent.predict(question),
    gammaAgent.predict(question)
  ]);

  const agents = [
    { key: "WEATHER_ALPHA", res: alphaRes },
    { key: "WEATHER_BETA", res: betaRes },
    { key: "WEATHER_GAMMA", res: gammaRes }
  ];

  const commitments = {};

  for (const item of agents) {
    const r = item.res;
    // Generate secure random 32-byte salt
    const salt = ethers.hexlify(crypto.randomBytes(32));

    // Convert confidence to basis points (e.g. 0.85 -> 8500)
    const confidenceBps = Math.round(r.confidence * 10000);
    const predictionValue = r.prediction; // 1 = Yes, 0 = No

    // Cryptographic commitment matching SwarmMindCore.computeCommitmentHash
    const commitmentHash = ethers.solidityPackedKeccak256(
      ["uint256", "bytes32", "int256", "uint256", "bytes32"],
      [swarmId, r.onChainAgentId, predictionValue, confidenceBps, salt]
    );

    commitments[item.key] = {
      agentName: item.key,
      agentId: r.onChainAgentId,
      swarmId: swarmId,
      prediction: predictionValue,
      predictionText: predictionValue === 1 ? "YES" : "NO",
      confidence: confidenceBps,
      confidenceDecimal: r.confidence,
      salt: salt,
      commitmentHash: commitmentHash,
      reasoning: r.reasoning,
      evidence: r.evidence,
      generatedAt: new Date().toISOString(),
      committedOnChain: false,
      txHash: null,
      blockNumber: null
    };
  }

  const payload = {
    swarmId: swarmId,
    question: question,
    generatedAt: new Date().toISOString(),
    commitments: commitments
  };

  fs.writeFileSync(storePath, JSON.stringify(payload, null, 2));
  console.log(`Securely saved off-chain commitments to ${storePath}`);

  return payload;
}

/**
 * Get sanitized commitment data for frontend during COMMIT phase.
 * Hides raw prediction, confidence, and salt to preserve cryptographic privacy.
 */
function getSanitizedCommitments(swarmId = 1) {
  const storePath = getStoragePath(swarmId);
  if (!fs.existsSync(storePath)) {
    return { swarmId, commitments: {} };
  }

  const stored = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const sanitized = {};

  for (const [key, c] of Object.entries(stored.commitments)) {
    sanitized[key] = {
      agentName: c.agentName,
      agentId: c.agentId,
      swarmId: c.swarmId,
      commitmentHash: c.commitmentHash,
      // Private fields hidden from other agents during commit phase:
      prediction: "[HIDDEN UNTIL REVEAL]",
      confidence: "[HIDDEN UNTIL REVEAL]",
      salt: "[HIDDEN UNTIL REVEAL]",
      reasoningLength: c.reasoning.length,
      evidenceCount: c.evidence.length,
      generatedAt: c.generatedAt,
      committedOnChain: c.committedOnChain,
      txHash: c.txHash,
      blockNumber: c.blockNumber
    };
  }

  return {
    swarmId: stored.swarmId,
    question: stored.question,
    commitments: sanitized
  };
}

function updateCommitReceipt(swarmId, agentKey, txHash, blockNumber) {
  const storePath = getStoragePath(swarmId);
  if (!fs.existsSync(storePath)) return false;

  const stored = JSON.parse(fs.readFileSync(storePath, "utf8"));
  if (stored.commitments[agentKey]) {
    stored.commitments[agentKey].committedOnChain = true;
    stored.commitments[agentKey].txHash = txHash;
    stored.commitments[agentKey].blockNumber = blockNumber;
    stored.commitments[agentKey].committedAt = new Date().toISOString();
    fs.writeFileSync(storePath, JSON.stringify(stored, null, 2));
    return true;
  }
  return false;
}

function computeCommitmentHashLocal(swarmId, agentId, predictionValue, confidenceBps, salt) {
  return ethers.solidityPackedKeccak256(
    ["uint256", "bytes32", "int256", "uint256", "bytes32"],
    [swarmId, agentId, predictionValue, confidenceBps, salt]
  );
}

function getRevealPayload(swarmId = 1, agentKey) {
  const storePath = getStoragePath(swarmId);
  if (!fs.existsSync(storePath)) {
    throw new Error(`No commitment storage found for swarm #${swarmId}`);
  }

  const stored = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const c = stored.commitments[agentKey];
  if (!c) {
    throw new Error(`Agent ${agentKey} not found in swarm #${swarmId} commitments`);
  }

  // Pre-verification: Verify local computed hash matches stored hash
  const computedHash = computeCommitmentHashLocal(
    swarmId,
    c.agentId,
    c.prediction,
    c.confidence,
    c.salt
  );

  if (computedHash.toLowerCase() !== c.commitmentHash.toLowerCase()) {
    throw new Error(
      `FATAL: Cryptographic mismatch for ${agentKey}! Computed: ${computedHash}, Stored: ${c.commitmentHash}. Revealing aborted.`
    );
  }

  return {
    swarmId: Number(swarmId),
    agentKey: agentKey,
    agentId: c.agentId,
    prediction: c.prediction,
    predictionText: c.predictionText,
    confidence: c.confidence,
    confidenceDecimal: c.confidenceDecimal,
    salt: c.salt,
    commitmentHash: c.commitmentHash,
    reasoning: c.reasoning,
    evidence: c.evidence,
    verified: true
  };
}

function updateRevealReceipt(swarmId, agentKey, txHash, blockNumber) {
  const storePath = getStoragePath(swarmId);
  if (!fs.existsSync(storePath)) return false;

  const stored = JSON.parse(fs.readFileSync(storePath, "utf8"));
  if (stored.commitments[agentKey]) {
    stored.commitments[agentKey].revealedOnChain = true;
    stored.commitments[agentKey].revealTxHash = txHash;
    stored.commitments[agentKey].revealBlockNumber = blockNumber;
    stored.commitments[agentKey].revealedAt = new Date().toISOString();
    fs.writeFileSync(storePath, JSON.stringify(stored, null, 2));
    return true;
  }
  return false;
}

function getFullCommitments(swarmId = 1) {
  const storePath = getStoragePath(swarmId);
  if (!fs.existsSync(storePath)) return null;
  return JSON.parse(fs.readFileSync(storePath, "utf8"));
}

module.exports = {
  generateAndStoreCommitments,
  getSanitizedCommitments,
  getFullCommitments,
  updateCommitReceipt,
  getRevealPayload,
  updateRevealReceipt,
  computeCommitmentHashLocal
};

