const { expect } = require("chai");
const { ethers } = require("hardhat");
const crypto = require("crypto");

describe("Milestone 6: Real Prediction Reveal & Cryptographic Verification", function () {
  let SwarmMindCore, swarmMind;
  let MVPControlledResolver, resolver;
  let owner, creator, agentOwner, otherAgentOwner, outsider;

  const agentAlphaId = ethers.id("WEATHER_ALPHA");
  const agentBetaId = ethers.id("WEATHER_BETA");
  const agentGammaId = ethers.id("WEATHER_GAMMA");

  const minBond = ethers.parseEther("0.001");
  const bounty = ethers.parseEther("0.005");

  // Sample values
  const alphaPred = 1;
  const alphaConf = 6000;
  const alphaSalt = ethers.hexlify(crypto.randomBytes(32));

  const betaPred = 1;
  const betaConf = 5800;
  const betaSalt = ethers.hexlify(crypto.randomBytes(32));

  const gammaPred = 1;
  const gammaConf = 7300;
  const gammaSalt = ethers.hexlify(crypto.randomBytes(32));

  let alphaHash, betaHash, gammaHash;
  let commitDeadline, revealDeadline;

  beforeEach(async function () {
    [owner, creator, agentOwner, otherAgentOwner, outsider] = await ethers.getSigners();

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

    // Compute hashes
    alphaHash = await swarmMind.computeCommitmentHash(1, agentAlphaId, alphaPred, alphaConf, alphaSalt);
    betaHash = await swarmMind.computeCommitmentHash(1, agentBetaId, betaPred, betaConf, betaSalt);
    gammaHash = await swarmMind.computeCommitmentHash(1, agentGammaId, gammaPred, gammaConf, gammaSalt);

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    commitDeadline = now + 86400;
    revealDeadline = now + 172800;

    const params = {
      questionHash: "ipfs://bafkreiRainChennai",
      requiredCapability: "WEATHER",
      commitDeadline: commitDeadline,
      revealDeadline: revealDeadline,
      requiredAgentCount: 3,
      minBond: minBond,
      minChallengeBond: ethers.parseEther("0.0005"),
      outcomeResolver: await resolver.getAddress()
    };

    await swarmMind.connect(creator).createSwarm(params, { value: bounty });
    await swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, agentGammaId]);
  });

  it("1. Valid reveal succeeds sequentially", async function () {
    // Commit all 3 agents
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    // Swarm is automatically in Revealing state (2)
    const swarm = await swarmMind.getSwarm(1);
    expect(swarm.state).to.equal(2n); // Revealing

    // 1. Reveal Alpha
    const txAlpha = await swarmMind.connect(agentOwner).revealPrediction(
      1,
      agentAlphaId,
      alphaPred,
      alphaConf,
      alphaSalt
    );
    await expect(txAlpha)
      .to.emit(swarmMind, "AgentRevealed")
      .withArgs(1, agentAlphaId, alphaPred, alphaConf);

    // 2. Reveal Beta
    const txBeta = await swarmMind.connect(agentOwner).revealPrediction(
      1,
      agentBetaId,
      betaPred,
      betaConf,
      betaSalt
    );
    await expect(txBeta)
      .to.emit(swarmMind, "AgentRevealed")
      .withArgs(1, agentBetaId, betaPred, betaConf);

    // 3. Reveal Gamma
    const txGamma = await swarmMind.connect(agentOwner).revealPrediction(
      1,
      agentGammaId,
      gammaPred,
      gammaConf,
      gammaSalt
    );
    await expect(txGamma)
      .to.emit(swarmMind, "AgentRevealed")
      .withArgs(1, agentGammaId, gammaPred, gammaConf);
  });

  it("2. Valid reveal changes on-chain state accurately", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    const before = await swarmMind.getPrediction(1, agentAlphaId);
    expect(before.revealed).to.be.false;
    expect(before.predictionValue).to.equal(0n);
    expect(before.confidence).to.equal(0n);
    expect(before.revealedAt).to.equal(0n);

    await swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt);

    const after = await swarmMind.getPrediction(1, agentAlphaId);
    expect(after.revealed).to.be.true;
    expect(after.predictionValue).to.equal(BigInt(alphaPred));
    expect(after.confidence).to.equal(BigInt(alphaConf));
    expect(after.revealedAt).to.be.gt(0n);
    expect(after.commitmentHash).to.equal(alphaHash);
    expect(after.bondAmount).to.equal(minBond);
  });

  it("3. Wrong prediction fails cryptographic verification", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    const wrongPred = 0; // original was 1
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, wrongPred, alphaConf, alphaSalt)
    ).to.be.revertedWith("SwarmMindCore: invalid reveal verification");
  });

  it("4. Wrong confidence fails cryptographic verification", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    const wrongConf = 9999; // original was 6000
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, wrongConf, alphaSalt)
    ).to.be.revertedWith("SwarmMindCore: invalid reveal verification");
  });

  it("5. Wrong salt fails cryptographic verification", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    const wrongSalt = ethers.hexlify(crypto.randomBytes(32));
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, wrongSalt)
    ).to.be.revertedWith("SwarmMindCore: invalid reveal verification");
  });

  it("6. Wrong agent ID or unauthorized non-owner caller fails", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    // Non-owner caller
    await expect(
      swarmMind.connect(outsider).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt)
    ).to.be.revertedWith("SwarmMindCore: caller is not agent owner");

    // Non-existent agent ID
    const fakeAgent = ethers.id("FAKE_AGENT");
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, fakeAgent, alphaPred, alphaConf, alphaSalt)
    ).to.be.revertedWith("SwarmMindCore: agent does not exist");
  });

  it("7. Wrong swarm ID fails", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    // Swarm 999 does not exist / not in reveal state
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(999, agentAlphaId, alphaPred, alphaConf, alphaSalt)
    ).to.be.revertedWith("SwarmMindCore: not in reveal state");
  });

  it("8. Reveal before reveal phase fails", async function () {
    // Commit only 1 agent (swarm remains in AgentsSelected state = 1)
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });

    const swarm = await swarmMind.getSwarm(1);
    expect(swarm.state).to.equal(1n); // AgentsSelected

    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt)
    ).to.be.revertedWith("SwarmMindCore: not in reveal state");
  });

  it("9. Reveal after reveal deadline fails", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    // Fast forward past revealDeadline
    await ethers.provider.send("evm_setNextBlockTimestamp", [revealDeadline + 10]);
    await ethers.provider.send("evm_mine");

    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt)
    ).to.be.revertedWith("SwarmMindCore: reveal deadline passed");
  });

  it("10. Double reveal fails", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    // First reveal succeeds
    await swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt);

    // Second reveal for same agent fails
    await expect(
      swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt)
    ).to.be.revertedWith("SwarmMindCore: already revealed");
  });

  it("11. Commitment remains cryptographically verifiable after reveal", async function () {
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    await swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt);

    // Read stored on-chain commitment and revealed data
    const p = await swarmMind.getPrediction(1, agentAlphaId);
    expect(p.revealed).to.be.true;

    // Cryptographically recompute commitment using on-chain function
    const recomputedOnChain = await swarmMind.computeCommitmentHash(
      1,
      agentAlphaId,
      p.predictionValue,
      p.confidence,
      alphaSalt
    );
    expect(recomputedOnChain).to.equal(p.commitmentHash);

    // Cryptographically recompute locally using standard keccak256
    const recomputedLocal = ethers.solidityPackedKeccak256(
      ["uint256", "bytes32", "int256", "uint256", "bytes32"],
      [1, agentAlphaId, p.predictionValue, p.confidence, alphaSalt]
    );
    expect(recomputedLocal).to.equal(p.commitmentHash);
  });
});
