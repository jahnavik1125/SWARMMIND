const { selectAgentsForQuestion } = require("./agent-router.js");
const { executeSelectedAgents } = require("./agent-engine.js");
const blockchain = require("./blockchain-service.js");
const { generateDebate } = require("./debate-engine.js");
const { computeConsensus } = require("./consensus-engine.js");
const db = require("./database.js");

/**
 * MASTER SWARM COORDINATOR
 * Orchestrates the full 10-step decentralized prediction lifecycle:
 * Question -> Router -> Discovery -> Selection -> Independent Answers ->
 * Commit -> Reveal -> Debate -> Consensus -> Final Answer -> (Pending Verification)
 */

async function runSwarmMind(question) {
  if (!question || typeof question !== "string" || !question.trim()) {
    throw new Error("Question cannot be empty");
  }

  const swarmId = `swarm-${Date.now()}`;
  const createdAt = new Date().toISOString();

  // 1. Question / Domain Analysis & Dynamic Agent Selection
  const routing = selectAgentsForQuestion(question);

  // 2. Independent Analysis Phase (Agents reason privately without seeing each other)
  const rawPredictions = await executeSelectedAgents(routing.selectedAgentIds, question);

  // 3. Cryptographic Commitment Phase (Sealed envelope + stake on blockchain)
  const commitments = [];
  for (const pred of rawPredictions) {
    const agentMeta = db.getAgentById(pred.agentId);
    const commitment = blockchain.createCommitmentRecord(
      Date.now() % 100000,
      agentMeta,
      pred.predictionValue,
      pred.confidence
    );
    commitments.push(commitment);
  }

  // 4. Reveal & Cryptographic Verification Phase
  const reveals = [];
  for (const commit of commitments) {
    const verifyResult = blockchain.verifyReveal(commit);
    reveals.push({
      agentId: commit.agentId,
      agentName: commit.agentName,
      predictionValue: commit.predictionValue,
      confidence: commit.confidence,
      salt: commit.salt,
      verification: verifyResult
    });
  }

  // 5. Agent Debate & Challenge Phase (Agents cross-examine each other's evidence)
  const debateMessages = generateDebate(question, rawPredictions);

  // 6. Consensus Engine (Reputation-weighted synthesis, NOT a simple arithmetic average)
  const consensus = computeConsensus(question, rawPredictions, debateMessages);

  // 7. Assemble the Swarm Record
  const swarmRecord = {
    swarmId,
    question,
    createdAt,
    status: "PENDING",
    primaryDomain: routing.primaryDomain,
    requiredDomains: routing.requiredDomains,
    routingRationale: routing.routingRationale,
    selectedAgents: routing.selectedAgents,
    agentPredictions: rawPredictions,
    commitments,
    reveals,
    debateMessages,
    consensus,
    finalOutcome: null,
    groundTruthEvidence: null,
    resolvedAt: null,
    agentResults: []
  };

  // Save to persistent database
  db.saveSwarm(swarmRecord);

  return swarmRecord;
}

module.exports = {
  runSwarmMind
};
