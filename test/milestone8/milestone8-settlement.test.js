const { expect } = require("chai");
const { ethers } = require("hardhat");
const crypto = require("crypto");

describe("Milestone 8: Real Outcome Resolution & Smart Contract Settlement", function () {
  let SwarmMindCore, swarmMind;
  let MVPControlledResolver, resolver;
  let owner, creator, agentOwner, challenger, outsider;

  const agentAlphaId = ethers.id("WEATHER_ALPHA");
  const agentBetaId = ethers.id("WEATHER_BETA");
  const agentGammaId = ethers.id("WEATHER_GAMMA");

  const minBond = ethers.parseEther("0.001");
  const minChallengeBond = ethers.parseEther("0.0005");
  const bounty = ethers.parseEther("0.005");

  // Alpha & Beta predict YES (1), Gamma predicts NO (0) to test settlement with both correct & incorrect agents
  const alphaPred = 1;
  const alphaConf = 6000;
  const alphaSalt = ethers.hexlify(crypto.randomBytes(32));

  const betaPred = 1;
  const betaConf = 5800;
  const betaSalt = ethers.hexlify(crypto.randomBytes(32));

  const gammaPred = 0; // Predicts NO
  const gammaConf = 7300;
  const gammaSalt = ethers.hexlify(crypto.randomBytes(32));

  let alphaHash, betaHash, gammaHash;

  beforeEach(async function () {
    [owner, creator, agentOwner, challenger, outsider] = await ethers.getSigners();

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

    alphaHash = await swarmMind.computeCommitmentHash(1, agentAlphaId, alphaPred, alphaConf, alphaSalt);
    betaHash = await swarmMind.computeCommitmentHash(1, agentBetaId, betaPred, betaConf, betaSalt);
    gammaHash = await swarmMind.computeCommitmentHash(1, agentGammaId, gammaPred, gammaConf, gammaSalt);

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const params = {
      questionHash: "ipfs://bafkreiRainChennai",
      requiredCapability: "WEATHER",
      commitDeadline: now + 86400,
      revealDeadline: now + 172800,
      requiredAgentCount: 3,
      minBond: minBond,
      minChallengeBond: minChallengeBond,
      outcomeResolver: await resolver.getAddress()
    };

    // Create Swarm #1 (Bounty: 0.005 MSTC)
    await swarmMind.connect(creator).createSwarm(params, { value: bounty });
    await swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, agentGammaId]);

    // Commit all 3 (3 x 0.001 MSTC = 0.003 MSTC)
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    // Reveal all 3
    await swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt);
    await swarmMind.connect(agentOwner).revealPrediction(1, agentBetaId, betaPred, betaConf, betaSalt);
    await swarmMind.connect(agentOwner).revealPrediction(1, agentGammaId, gammaPred, gammaConf, gammaSalt);
  });

  it("1. Valid outcome resolution via MVPControlledResolver", async function () {
    const evidenceData = ethers.toUtf8Bytes("Measured rainfall: 1.9 mm >= 0.5 mm threshold");

    // Owner sets outcome in resolver
    await resolver.connect(owner).setOutcome(1, 1, evidenceData);
    expect(await resolver.isResolved(1)).to.be.true;

    const [res, val, ev] = await resolver.getOutcome(1);
    expect(res).to.be.true;
    expect(val).to.equal(1n);

    // Call resolveSwarm on SwarmMindCore
    const tx = await swarmMind.resolveSwarm(1);
    await expect(tx).to.emit(swarmMind, "SwarmResolved").withArgs(1, 1n, evidenceData);

    const swarm = await swarmMind.getSwarm(1);
    expect(swarm.state).to.equal(3n); // SwarmState.Resolved
    expect(swarm.finalOutcome).to.equal(1n);
  });

  it("2. Unauthorized resolver cannot set outcome in MVPControlledResolver", async function () {
    const evidenceData = ethers.toUtf8Bytes("Fake evidence");
    await expect(
      resolver.connect(outsider).setOutcome(1, 1, evidenceData)
    ).to.be.revertedWith("MVPControlledResolver: unauthorized");
  });

  it("3. Outcome already set in MVPControlledResolver is rejected", async function () {
    const evidenceData = ethers.toUtf8Bytes("Evidence 1");
    await resolver.connect(owner).setOutcome(1, 1, evidenceData);

    await expect(
      resolver.connect(owner).setOutcome(1, 1, evidenceData)
    ).to.be.revertedWith("MVPControlledResolver: outcome already set");
  });

  it("4. Settle fails if swarm is not in Resolved state", async function () {
    // Swarm is still in Revealing state (2)
    await expect(
      swarmMind.settleSwarm(1)
    ).to.be.revertedWith("SwarmMindCore: swarm not resolved");
  });

  it("5, 6, 7 & 10. Settlement: Correct agent rewarded, incorrect slashed, bonds returned & reputation updated", async function () {
    const evidenceData = ethers.toUtf8Bytes("Measured rainfall: 1.9 mm (YES)");
    await resolver.connect(owner).setOutcome(1, 1, evidenceData);
    await swarmMind.resolveSwarm(1);

    const initialOwnerBal = await ethers.provider.getBalance(agentOwner.address);
    const initialRepAlpha = await swarmMind.getAgentReputation(agentAlphaId, "WEATHER");
    const initialRepGamma = await swarmMind.getAgentReputation(agentGammaId, "WEATHER");
    expect(initialRepAlpha).to.equal(0n);
    expect(initialRepGamma).to.equal(0n);

    // Settle Swarm #1
    const tx = await swarmMind.settleSwarm(1);
    const receipt = await tx.wait();

    // Verify Swarm state is Settled (4)
    const swarm = await swarmMind.getSwarm(1);
    expect(swarm.state).to.equal(4n); // Settled

    // Alpha & Beta were correct (predicted 1, outcome 1)
    // Gamma was incorrect (predicted 0, outcome 1) -> bond slashed!
    // Reputation updates:
    const newRepAlpha = await swarmMind.getAgentReputation(agentAlphaId, "WEATHER");
    const newRepBeta = await swarmMind.getAgentReputation(agentBetaId, "WEATHER");
    const newRepGamma = await swarmMind.getAgentReputation(agentGammaId, "WEATHER");

    expect(newRepAlpha).to.equal(500n); // +500 bps boost
    expect(newRepBeta).to.equal(500n);  // +500 bps boost
    expect(newRepGamma).to.equal(0n);    // 0 - 500 clamped at 0

    // Check payouts to agentOwner (owns Alpha, Beta, and Gamma)
    // Payout should include:
    // - Refunded prediction bonds for Alpha and Beta (2 x 0.001 = 0.002 MSTC)
    // - Bounty (0.005 MSTC) + Gamma's slashed bond (0.001 MSTC) = 0.006 MSTC distributed evenly (3000 each)
    // Total received = 0.002 + 0.006 = 0.008 MSTC
    const finalOwnerBal = await ethers.provider.getBalance(agentOwner.address);
    expect(finalOwnerBal - initialOwnerBal).to.equal(ethers.parseEther("0.008"));
  });

  it("8. Challenge settlement: Upheld challenge rewards challenger and slashes target agent", async function () {
    // Challenger challenges Gamma (who predicted 0)
    await swarmMind.connect(challenger).challengePrediction(
      1,
      agentGammaId,
      "ipfs://challengeGamma",
      { value: minChallengeBond }
    );

    const evidenceData = ethers.toUtf8Bytes("Measured rainfall: 1.9 mm (YES)");
    await resolver.connect(owner).setOutcome(1, 1, evidenceData);
    await swarmMind.resolveSwarm(1);

    const challengerBalBefore = await ethers.provider.getBalance(challenger.address);

    await swarmMind.settleSwarm(1);

    // Challenge on Gamma should be UPHELD (status = 1) because Gamma was incorrect
    const ch = await swarmMind.getChallenge(1);
    expect(ch.status).to.equal(1); // ChallengeStatus.Upheld

    // Challenger receives bond back (0.0005) + bonus from half of slashed bond (0.001 / 2 = 0.0005)
    // Total = 0.0010 MSTC
    const challengerBalAfter = await ethers.provider.getBalance(challenger.address);
    expect(challengerBalAfter - challengerBalBefore).to.equal(ethers.parseEther("0.0010"));
  });

  it("9. Challenge settlement: Dismissed challenge slashes challenger bond", async function () {
    // Challenger incorrectly challenges Alpha (who predicted 1)
    await swarmMind.connect(challenger).challengePrediction(
      1,
      agentAlphaId,
      "ipfs://challengeAlpha",
      { value: minChallengeBond }
    );

    const evidenceData = ethers.toUtf8Bytes("Measured rainfall: 1.9 mm (YES)");
    await resolver.connect(owner).setOutcome(1, 1, evidenceData);
    await swarmMind.resolveSwarm(1);

    const challengerBalBefore = await ethers.provider.getBalance(challenger.address);

    await swarmMind.settleSwarm(1);

    // Challenge on Alpha should be DISMISSED (status = 2) because Alpha was correct
    const ch = await swarmMind.getChallenge(1);
    expect(ch.status).to.equal(2); // ChallengeStatus.Dismissed

    // Challenger receives 0 (bond slashed)
    const challengerBalAfter = await ethers.provider.getBalance(challenger.address);
    expect(challengerBalAfter).to.equal(challengerBalBefore);
  });

  it("11 & 12. Complete Escrow Accounting Reconciliation", async function () {
    // Escrow before settlement: Bounty (0.005) + 3 bonds (0.003) = 0.008 MSTC
    const coreBalBefore = await ethers.provider.getBalance(await swarmMind.getAddress());
    expect(coreBalBefore).to.equal(ethers.parseEther("0.008"));

    const evidenceData = ethers.toUtf8Bytes("Measured rainfall: 1.9 mm (YES)");
    await resolver.connect(owner).setOutcome(1, 1, evidenceData);
    await swarmMind.resolveSwarm(1);
    await swarmMind.settleSwarm(1);

    // Escrow after settlement must be exactly 0
    const coreBalAfter = await ethers.provider.getBalance(await swarmMind.getAddress());
    expect(coreBalAfter).to.equal(0n);
  });
});
