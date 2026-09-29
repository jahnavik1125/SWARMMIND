const { expect } = require("chai");
const { ethers } = require("hardhat");
const crypto = require("crypto");
const { generateAndStoreCommitments, getSanitizedCommitments, getFullCommitments } = require("../../services/commitment-store.js");
const alphaAgent = require("../../agents/weather-alpha/agent.js");
const betaAgent = require("../../agents/weather-beta/agent.js");
const gammaAgent = require("../../agents/weather-gamma/agent.js");

describe("Milestone 5: Real Agent Prediction Commitments & Prediction Bonds", function () {
  let SwarmMindCore, swarmMind;
  let MVPControlledResolver, resolver;
  let owner, creator, agentOwner, outsider;

  const agentAlphaId = ethers.id("WEATHER_ALPHA");
  const agentBetaId = ethers.id("WEATHER_BETA");
  const agentGammaId = ethers.id("WEATHER_GAMMA");
  const unselectedAgentId = ethers.id("WEATHER_UNSELECTED");

  const minBond = ethers.parseEther("0.001");
  const bounty = ethers.parseEther("0.005");

  beforeEach(async function () {
    [owner, creator, agentOwner, outsider] = await ethers.getSigners();

    MVPControlledResolver = await ethers.getContractFactory("MVPControlledResolver");
    resolver = await MVPControlledResolver.deploy();
    await resolver.waitForDeployment();

    SwarmMindCore = await ethers.getContractFactory("SwarmMindCore");
    swarmMind = await SwarmMindCore.deploy();
    await swarmMind.waitForDeployment();

    // Register 3 agents owned by agentOwner
    await swarmMind.connect(agentOwner).registerAgent(agentAlphaId, "WEATHER", "ipfs://alpha");
    await swarmMind.connect(agentOwner).registerAgent(agentBetaId, "WEATHER", "ipfs://beta");
    await swarmMind.connect(agentOwner).registerAgent(agentGammaId, "WEATHER", "ipfs://gamma");

    // Register an unselected agent
    await swarmMind.connect(outsider).registerAgent(unselectedAgentId, "WEATHER", "ipfs://unselected");

    // Create Swarm #1
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const params = {
      questionHash: "ipfs://bafkreiRainChennai",
      requiredCapability: "WEATHER",
      commitDeadline: now + 86400,
      revealDeadline: now + 172800,
      requiredAgentCount: 3,
      minBond: minBond,
      minChallengeBond: ethers.parseEther("0.0005"),
      outcomeResolver: await resolver.getAddress()
    };

    await swarmMind.connect(creator).createSwarm(params, { value: bounty });
    await swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, agentGammaId]);
  });

  it("1. Agent generates valid structured prediction with real evidence", async function () {
    const pAlpha = await alphaAgent.predict("Will it rain in Chennai tomorrow?");
    expect(pAlpha.agentId).to.equal("WEATHER_ALPHA");
    expect([0, 1]).to.include(pAlpha.prediction);
    expect(pAlpha.confidence).to.be.within(0.5, 1.0);
    expect(pAlpha.reasoning).to.be.a("string").with.length.above(50);
    expect(pAlpha.evidence).to.be.an("array").with.length.above(0);

    const pBeta = await betaAgent.predict("Will it rain in Chennai tomorrow?");
    const pGamma = await gammaAgent.predict("Will it rain in Chennai tomorrow?");
    expect([0, 1]).to.include(pBeta.prediction);
    expect([0, 1]).to.include(pGamma.prediction);
  });

  it("2 & 3. Prediction + confidence + salt produce valid commitment matching Solidity verification", async function () {
    const salt = ethers.hexlify(crypto.randomBytes(32));
    const pred = 1;
    const conf = 8500;

    const localHash = ethers.solidityPackedKeccak256(
      ["uint256", "bytes32", "int256", "uint256", "bytes32"],
      [1, agentAlphaId, pred, conf, salt]
    );

    const onChainHash = await swarmMind.computeCommitmentHash(1, agentAlphaId, pred, conf, salt);
    expect(localHash).to.equal(onChainHash);
  });

  it("4 & 5. Commit succeeds for authorized owner and locks exact prediction bond", async function () {
    const salt = ethers.hexlify(crypto.randomBytes(32));
    const hash = await swarmMind.computeCommitmentHash(1, agentAlphaId, 1, 8500, salt);

    const contractBalBefore = await ethers.provider.getBalance(await swarmMind.getAddress());

    // Commit with minBond
    const tx = await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, hash, { value: minBond });
    await expect(tx)
      .to.emit(swarmMind, "AgentCommitted")
      .withArgs(1, agentAlphaId, hash, minBond);

    const contractBalAfter = await ethers.provider.getBalance(await swarmMind.getAddress());
    expect(contractBalAfter - contractBalBefore).to.equal(minBond);

    const pred = await swarmMind.getPrediction(1, agentAlphaId);
    expect(pred.committed).to.be.true;
    expect(pred.revealed).to.be.false;
    expect(pred.bondAmount).to.equal(minBond);
  });

  it("6. Unauthorized agent or non-selected agent cannot commit", async function () {
    const salt = ethers.hexlify(crypto.randomBytes(32));
    const hash = await swarmMind.computeCommitmentHash(1, agentAlphaId, 1, 8500, salt);

    // Outsider cannot commit for agentAlpha (not agent owner)
    await expect(
      swarmMind.connect(outsider).commitPrediction(1, agentAlphaId, hash, { value: minBond })
    ).to.be.revertedWith("SwarmMindCore: caller is not agent owner");

    // Outsider cannot commit for unselected agent
    const unselectedHash = await swarmMind.computeCommitmentHash(1, unselectedAgentId, 1, 8500, salt);
    await expect(
      swarmMind.connect(outsider).commitPrediction(1, unselectedAgentId, unselectedHash, { value: minBond })
    ).to.be.revertedWith("SwarmMindCore: agent not selected for swarm");
  });

  it("7. Double commit for the same agent in the same swarm is rejected", async function () {
    const salt1 = ethers.hexlify(crypto.randomBytes(32));
    const hash1 = await swarmMind.computeCommitmentHash(1, agentAlphaId, 1, 8500, salt1);

    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, hash1, { value: minBond });

    // Attempt second commit for same agent
    const salt2 = ethers.hexlify(crypto.randomBytes(32));
    const hash2 = await swarmMind.computeCommitmentHash(1, agentAlphaId, 0, 7500, salt2);

    await expect(
      swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, hash2, { value: minBond })
    ).to.be.revertedWith("SwarmMindCore: already committed");
  });

  it("8. Sanitized commitment does not expose prediction or salt to frontend during commit phase", function () {
    const sanitized = getSanitizedCommitments(1);
    expect(sanitized.commitments).to.have.property("WEATHER_ALPHA");
    const alpha = sanitized.commitments.WEATHER_ALPHA;

    expect(alpha.prediction).to.equal("[HIDDEN UNTIL REVEAL]");
    expect(alpha.confidence).to.equal("[HIDDEN UNTIL REVEAL]");
    expect(alpha.salt).to.equal("[HIDDEN UNTIL REVEAL]");
    expect(alpha.commitmentHash).to.be.properHex(64);
  });

  it("9, 10 & 11. Altered prediction, confidence, or salt fails cryptographic reveal verification", async function () {
    const salt = ethers.hexlify(crypto.randomBytes(32));
    const realPred = 1;
    const realConf = 9000;
    const hash = await swarmMind.computeCommitmentHash(1, agentAlphaId, realPred, realConf, salt);

    // Commit all 3 to transition to revealing phase
    const salt2 = ethers.hexlify(crypto.randomBytes(32));
    const salt3 = ethers.hexlify(crypto.randomBytes(32));
    const hash2 = await swarmMind.computeCommitmentHash(1, agentBetaId, 1, 8000, salt2);
    const hash3 = await swarmMind.computeCommitmentHash(1, agentGammaId, 1, 7500, salt3);

    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, hash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, hash2, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, hash3, { value: minBond });

    const swarm = await swarmMind.getSwarm(1);
    expect(swarm.state).to.equal(2); // Revealing

    // 9. Altered prediction fails
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, 0, realConf, salt)
    ).to.be.revertedWith("SwarmMindCore: invalid reveal verification");

    // 10. Altered confidence fails
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, realPred, 8000, salt)
    ).to.be.revertedWith("SwarmMindCore: invalid reveal verification");

    // 11. Altered salt fails
    const fakeSalt = ethers.hexlify(crypto.randomBytes(32));
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, realPred, realConf, fakeSalt)
    ).to.be.revertedWith("SwarmMindCore: invalid reveal verification");

    // Authentic reveal succeeds
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, realPred, realConf, salt)
    ).to.emit(swarmMind, "AgentRevealed").withArgs(1, agentAlphaId, realPred, realConf);
  });
});
