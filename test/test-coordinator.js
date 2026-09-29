const { runSwarmMind } = require("../services/swarm-coordinator.js");
const { resolveSwarmOutcome } = require("../services/outcome-service.js");

async function test() {
  console.log("--- TEST 1: Weather in Bengaluru ---");
  const s1 = await runSwarmMind("Will it rain tomorrow in Bengaluru?");
  console.log("Selected Agents:", s1.selectedAgents.map(a => a.name));
  console.log("Commitments:", s1.commitments.length);
  console.log("Reveals:", s1.reveals.map(r => `${r.agentName}: ${r.verification.status}`));
  console.log("Debate Messages:", s1.debateMessages.length);
  console.log("Consensus:", s1.consensus.finalDecision, `(${s1.consensus.confidence}%)`);

  console.log("\n--- TEST 2: Outcome Verification Loop ---");
  const res = resolveSwarmOutcome(s1.swarmId, 1, "IMD Bengaluru Observatory measured 5.2mm rain.");
  console.log("Outcome Result:", res.status, "Updated agents:", res.agentResults.length);
  console.log("First agent rep change:", res.agentResults[0].reputationDelta, "New Rep:", res.agentResults[0].newDomainReputation);

  console.log("\n--- TEST 3: Bridge Across River ---");
  const s2 = await runSwarmMind("Should we build a bridge across this river?");
  console.log("Selected Agents:", s2.selectedAgents.map(a => a.name));
  console.log("Consensus:", s2.consensus.finalDecision, `(${s2.consensus.confidence}%)`);
}

test().catch(console.error);
