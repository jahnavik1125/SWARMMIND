const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const DEPLOYED_PATH = path.join(__dirname, "..", "deployed-contracts.json");

function getSwarmMindCoreContract(provider) {
  if (!fs.existsSync(DEPLOYED_PATH)) {
    throw new Error("deployed-contracts.json not found");
  }
  const deployed = JSON.parse(fs.readFileSync(DEPLOYED_PATH, "utf8"));
  const coreAddress = deployed.contracts.SwarmMindCore.address;

  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "SwarmMindCore.sol", "SwarmMindCore.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  return new ethers.Contract(coreAddress, artifact.abi, provider);
}

/**
 * Discovers and filters eligible agents strictly from MST Testnet.
 * Distinguishes on-chain identity from off-chain agent services.
 */
async function discoverAgents(requiredCapability = "WEATHER") {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const core = getSwarmMindCoreContract(provider);

  const allAgentIds = await core.getAllAgentIds();
  const eligibleAgents = [];
  const ineligibleAgents = [];

  // Load known off-chain metadata mappings
  const metadataDir = path.join(__dirname, "..", "metadata", "agents");
  const knownMetadata = {};
  if (fs.existsSync(metadataDir)) {
    const files = fs.readdirSync(metadataDir).filter(f => f.endsWith(".json"));
    for (const f of files) {
      const content = JSON.parse(fs.readFileSync(path.join(metadataDir, f), "utf8"));
      knownMetadata[content.agentId.toLowerCase()] = content;
    }
  }

  for (const agentId of allAgentIds) {
    const ag = await core.getAgent(agentId);
    const rep = await core.getAgentReputation(agentId, ag.capability);

    const onChainIdentity = {
      agentId: agentId,
      owner: ag.owner,
      capability: ag.capability,
      active: ag.active,
      registeredAt: Number(ag.registeredAt),
      metadataUri: ag.metadataUri,
      reputationBps: Number(rep),
    };

    const offChainMeta = knownMetadata[agentId.toLowerCase()] || {
      name: `Agent-${agentId.slice(0, 8)}`,
      role: "Generic Agent",
      endpoint: "N/A",
      evidenceSources: []
    };

    const combinedAgent = {
      onChain: onChainIdentity,
      offChain: {
        name: offChainMeta.name,
        role: offChainMeta.role,
        description: offChainMeta.description || "",
        endpoint: offChainMeta.endpoint || "",
        evidenceSources: offChainMeta.evidenceSources || [],
        model: offChainMeta.model || {}
      },
      isEligible: ag.active && ag.capability === requiredCapability
    };

    if (combinedAgent.isEligible) {
      eligibleAgents.push(combinedAgent);
    } else {
      ineligibleAgents.push(combinedAgent);
    }
  }

  return {
    requiredCapability,
    totalOnChain: allAgentIds.length,
    eligibleCount: eligibleAgents.length,
    eligibleAgents,
    ineligibleAgents
  };
}

module.exports = { discoverAgents, getSwarmMindCoreContract };
