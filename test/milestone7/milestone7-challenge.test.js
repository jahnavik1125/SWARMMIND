const { expect } = require("chai");
const { ethers } = require("hardhat");
const crypto = require("crypto");

describe("Milestone 7: Real Challenge Market", function () {
  let SwarmMindCore, swarmMind;
  let MVPControlledResolver, resolver;
  let owner, creator, agentOwner, challenger1, challenger2, challenger3, challenger4, outsider;

  const agentAlphaId = ethers.id("WEATHER_ALPHA");
  const agentBetaId = ethers.id("WEATHER_BETA");
  const agentGammaId = ethers.id("WEATHER_GAMMA");

  const minBond = ethers.parseEther("0.001");
  const minChallengeBond = ethers.parseEther("0.0005");
  const bounty = ethers.parseEther("0.005");

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

  const sampleEvidenceHash = "ipfs://bafkreiChennaiRadarDryConvectionAnomalies2026";

  beforeEach(async function () {
    [owner, creator, agentOwner, challenger1, challenger2, challenger3, challenger4, outsider] = await ethers.getSigners();

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
    commitDeadline = now + 86400;
    revealDeadline = now + 172800;

    const params = {
      questionHash: "ipfs://bafkreiRainChennai",
      requiredCapability: "WEATHER",
      commitDeadline: commitDeadline,
      revealDeadline: revealDeadline,
      requiredAgentCount: 3,
      minBond: minBond,
      minChallengeBond: minChallengeBond,
      outcomeResolver: await resolver.getAddress()
    };

    await swarmMind.connect(creator).createSwarm(params, { value: bounty });
    await swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, agentGammaId]);

    // Commit all 3
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    // Reveal ALPHA and BETA (leave GAMMA initially unrevealed for testing invalid target)
    await swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt);
    await swarmMind.connect(agentOwner).revealPrediction(1, agentBetaId, betaPred, betaConf, betaSalt);
  });

  it("1. Valid challenge succeeds when protocol conditions are met", async function () {
    const initialContractBal = await ethers.provider.getBalance(await swarmMind.getAddress());

    const tx = await swarmMind.connect(challenger1).challengePrediction(
      1,
      agentAlphaId,
      sampleEvidenceHash,
      { value: minChallengeBond }
    );

    const receipt = await tx.wait();
    expect(receipt.status).to.equal(1);

    const newContractBal = await ethers.provider.getBalance(await swarmMind.getAddress());
    expect(newContractBal - initialContractBal).to.equal(minChallengeBond);

    const challenge = await swarmMind.getChallenge(1);
    expect(challenge.challengeId).to.equal(1n);
    expect(challenge.swarmId).to.equal(1n);
    expect(challenge.targetAgentId).to.equal(agentAlphaId);
    expect(challenge.challenger).to.equal(challenger1.address);
    expect(challenge.challengeBond).to.equal(minChallengeBond);
    expect(challenge.evidenceHash).to.equal(sampleEvidenceHash);
    expect(challenge.status).to.equal(0); // ChallengeStatus.Pending
  });

  it("2. Invalid challenger rejected: Agent owner cannot challenge own agent", async function () {
    await expect(
      swarmMind.connect(agentOwner).challengePrediction(
        1,
        agentAlphaId,
        sampleEvidenceHash,
        { value: minChallengeBond }
      )
    ).to.be.revertedWith("SwarmMindCore: cannot challenge own agent");
  });

  it("3. Wrong swarm rejected", async function () {
    await expect(
      swarmMind.connect(challenger1).challengePrediction(
        999,
        agentAlphaId,
        sampleEvidenceHash,
        { value: minChallengeBond }
      )
    ).to.be.revertedWith("SwarmMindCore: not in challengeable state");
  });

  it("4. Invalid target rejected: Unrevealed agent cannot be challenged", async function () {
    // GAMMA is committed but not yet revealed
    await expect(
      swarmMind.connect(challenger1).challengePrediction(
        1,
        agentGammaId,
        sampleEvidenceHash,
        { value: minChallengeBond }
      )
    ).to.be.revertedWith("SwarmMindCore: target has not revealed");
  });

  it("5. Incorrect bond rejected: Insufficient challenge bond", async function () {
    const lowBond = ethers.parseEther("0.0001"); // min is 0.0005
    await expect(
      swarmMind.connect(challenger1).challengePrediction(
        1,
        agentAlphaId,
        sampleEvidenceHash,
        { value: lowBond }
      )
    ).to.be.revertedWith("SwarmMindCore: insufficient challenge bond");
  });

  it("6. Challenge limit per prediction enforced (max 3 challenges)", async function () {
    // 1st challenge
    await swarmMind.connect(challenger1).challengePrediction(
      1,
      agentAlphaId,
      sampleEvidenceHash,
      { value: minChallengeBond }
    );
    // 2nd challenge
    await swarmMind.connect(challenger2).challengePrediction(
      1,
      agentAlphaId,
      sampleEvidenceHash,
      { value: minChallengeBond }
    );
    // 3rd challenge
    await swarmMind.connect(challenger3).challengePrediction(
      1,
      agentAlphaId,
      sampleEvidenceHash,
      { value: minChallengeBond }
    );

    // 4th challenge exceeds limit of 3
    await expect(
      swarmMind.connect(challenger4).challengePrediction(
        1,
        agentAlphaId,
        sampleEvidenceHash,
        { value: minChallengeBond }
      )
    ).to.be.revertedWith("SwarmMindCore: challenge limit reached for prediction");
  });

  it("7. Challenge event emitted properly", async function () {
    await expect(
      swarmMind.connect(challenger1).challengePrediction(
        1,
        agentAlphaId,
        sampleEvidenceHash,
        { value: minChallengeBond }
      )
    )
      .to.emit(swarmMind, "ChallengeCreated")
      .withArgs(
        1n,
        1n,
        agentAlphaId,
        challenger1.address,
        minChallengeBond,
        sampleEvidenceHash
      );
  });

  it("8. Challenge state readable on-chain via swarm and challenge getters", async function () {
    await swarmMind.connect(challenger1).challengePrediction(
      1,
      agentAlphaId,
      sampleEvidenceHash,
      { value: minChallengeBond }
    );

    const cIds = await swarmMind.getSwarmChallenges(1);
    expect(cIds.length).to.equal(1);
    expect(cIds[0]).to.equal(1n);

    const count = await swarmMind.predictionChallengeCount(1, agentAlphaId);
    expect(count).to.equal(1n);

    const ch = await swarmMind.getChallenge(1);
    expect(ch.challenger).to.equal(challenger1.address);
    expect(ch.targetAgentId).to.equal(agentAlphaId);
    expect(ch.status).to.equal(0); // Pending
  });

  it("9. Swarm state must be Revealing for challenges", async function () {
    // Fast forward past reveal and resolve directly
    await swarmMind.connect(creator).resolveSwarmDirect(1, 1, "0x1234");
    const swarm = await swarmMind.getSwarm(1);
    expect(swarm.state).to.equal(3n); // Resolved

    // Now challenge should fail with "SwarmMindCore: not in challengeable state"
    await expect(
      swarmMind.connect(challenger1).challengePrediction(
        1,
        agentAlphaId,
        sampleEvidenceHash,
        { value: minChallengeBond }
      )
    ).to.be.revertedWith("SwarmMindCore: not in challengeable state");
  });
});
