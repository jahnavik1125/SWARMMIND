const { expect } = require("chai");
const { ethers } = require("hardhat");
const crypto = require("crypto");
const { collectWeatherOutcome } = require("../../services/outcome-collector.js");

describe("Controlled Demonstration Swarm #2: Complete End-to-End Economic Lifecycle", function () {
  let SwarmMindCore, swarmMind;
  let MVPControlledResolver, resolver;
  let owner, creator, agentOwner, challenger, outsider;

  const agentAlphaId = ethers.id("WEATHER_ALPHA");
  const agentBetaId = ethers.id("WEATHER_BETA");
  const agentGammaId = ethers.id("WEATHER_GAMMA");

  const minBond = ethers.parseEther("0.001");
  const minChallengeBond = ethers.parseEther("0.0005");
  const bounty = ethers.parseEther("0.005");

  // Controlled test predictions:
  // Alpha & Beta predict YES (1)
  // Gamma predicts NO (0)
  const alphaPred = 1;
  const alphaConf = 6000;
  const alphaSalt = ethers.hexlify(crypto.randomBytes(32));

  const betaPred = 1;
  const betaConf = 5800;
  const betaSalt = ethers.hexlify(crypto.randomBytes(32));

  const gammaPred = 0;
  const gammaConf = 7300;
  const gammaSalt = ethers.hexlify(crypto.randomBytes(32));

  let alphaHash, betaHash, gammaHash;

  before(async function () {
    [owner, creator, agentOwner, challenger, outsider] = await ethers.getSigners();

    MVPControlledResolver = await ethers.getContractFactory("MVPControlledResolver");
    resolver = await MVPControlledResolver.deploy();
    await resolver.waitForDeployment();

    SwarmMindCore = await ethers.getContractFactory("SwarmMindCore");
    swarmMind = await SwarmMindCore.deploy();
    await swarmMind.waitForDeployment();

    // Register the 3 agents
    await swarmMind.connect(agentOwner).registerAgent(agentAlphaId, "WEATHER", "ipfs://alpha");
    await swarmMind.connect(agentOwner).registerAgent(agentBetaId, "WEATHER", "ipfs://beta");
    await swarmMind.connect(agentOwner).registerAgent(agentGammaId, "WEATHER", "ipfs://gamma");
  });

  it("1. Create Demo Swarm (Swarm #2) with genuine bounty escrowed", async function () {
    // First simulate Swarm #1 existence on contract to ensure Swarm #2 is created
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const p1 = {
      questionHash: "ipfs://realSwarm1RainChennai",
      requiredCapability: "WEATHER",
      commitDeadline: now + 86400,
      revealDeadline: now + 172800,
      requiredAgentCount: 3,
      minBond: minBond,
      minChallengeBond: minChallengeBond,
      outcomeResolver: await resolver.getAddress()
    };
    // Create Swarm #1 (Preserved Real Swarm)
    await swarmMind.connect(creator).createSwarm(p1, { value: bounty });
    const s1 = await swarmMind.getSwarm(1);
    expect(s1.swarmId).to.equal(1n);

    // Now Create Swarm #2 (Controlled Demo Swarm)
    const p2 = {
      questionHash: "ipfs://demoSwarm2PrecipitationThreshold",
      requiredCapability: "WEATHER",
      commitDeadline: now + 86400,
      revealDeadline: now + 172800,
      requiredAgentCount: 3,
      minBond: minBond,
      minChallengeBond: minChallengeBond,
      outcomeResolver: await resolver.getAddress()
    };

    const txCreate2 = await swarmMind.connect(creator).createSwarm(p2, { value: bounty });
    const rc2 = await txCreate2.wait();
    expect(rc2.status).to.equal(1);

    const s2 = await swarmMind.getSwarm(2);
    expect(s2.swarmId).to.equal(2n);
    expect(s2.bounty).to.equal(bounty);
    expect(s2.state).to.equal(0n); // Created
  });

  it("2. Select 3 registered agents for Swarm #2", async function () {
    const txSelect = await swarmMind.connect(creator).selectAgents(2, [
      agentAlphaId,
      agentBetaId,
      agentGammaId
    ]);
    await txSelect.wait();

    const s2 = await swarmMind.getSwarm(2);
    expect(s2.state).to.equal(1n); // AgentsSelected
    const selected = await swarmMind.getSwarmSelectedAgents(2);
    expect(selected.length).to.equal(3);
  });

  it("3. Commit predictions with locked prediction bonds (3 x 0.001 MSTC)", async function () {
    alphaHash = await swarmMind.computeCommitmentHash(2, agentAlphaId, alphaPred, alphaConf, alphaSalt);
    betaHash = await swarmMind.computeCommitmentHash(2, agentBetaId, betaPred, betaConf, betaSalt);
    gammaHash = await swarmMind.computeCommitmentHash(2, agentGammaId, gammaPred, gammaConf, gammaSalt);

    await swarmMind.connect(agentOwner).commitPrediction(2, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(2, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(2, agentGammaId, gammaHash, { value: minBond });

    const s2 = await swarmMind.getSwarm(2);
    expect(s2.totalBonded).to.equal(ethers.parseEther("0.003"));
    expect(s2.state).to.equal(2n); // Automatically transitioned to Revealing
  });

  it("4. Reveal predictions and cryptographically verify commitment hashes", async function () {
    const txRevAlpha = await swarmMind.connect(agentOwner).revealPrediction(2, agentAlphaId, alphaPred, alphaConf, alphaSalt);
    await txRevAlpha.wait();

    const txRevBeta = await swarmMind.connect(agentOwner).revealPrediction(2, agentBetaId, betaPred, betaConf, betaSalt);
    await txRevBeta.wait();

    const txRevGamma = await swarmMind.connect(agentOwner).revealPrediction(2, agentGammaId, gammaPred, gammaConf, gammaSalt);
    await txRevGamma.wait();

    const pcAlpha = await swarmMind.getPrediction(2, agentAlphaId);
    expect(pcAlpha.revealed).to.be.true;
    expect(pcAlpha.predictionValue).to.equal(1n); // YES

    const pcGamma = await swarmMind.getPrediction(2, agentGammaId);
    expect(pcGamma.revealed).to.be.true;
    expect(pcGamma.predictionValue).to.equal(0n); // NO
  });

  it("5. Resolve controlled test outcome via MVPControlledResolver (1.2 mm >= 0.5 mm -> YES)", async function () {
    // Fetch canonical demo outcome
    const demoData = await collectWeatherOutcome(2, { isControlledDemo: true });
    expect(demoData.status).to.equal("OUTCOME_READY");
    expect(demoData.outcome).to.equal("YES");
    expect(demoData.outcomeValue).to.equal(1);
    expect(demoData.sourceType).to.equal("CONTROLLED_DEMO_INPUT");

    // 1. setOutcome on MVPControlledResolver
    const txSet = await resolver.connect(owner).setOutcome(2, demoData.outcomeValue, demoData.evidenceBytes);
    await txSet.wait();
    expect(await resolver.isResolved(2)).to.be.true;

    // 2. resolveSwarm on SwarmMindCore
    const txResolve = await swarmMind.resolveSwarm(2);
    await txResolve.wait();

    const s2 = await swarmMind.getSwarm(2);
    expect(s2.state).to.equal(3n); // Resolved
    expect(s2.finalOutcome).to.equal(1n); // YES
  });

  it("6. Settle Swarm #2, distribute rewards, slash incorrect agents, update reputation & reconcile escrow", async function () {
    const repAlphaBefore = await swarmMind.getAgentReputation(agentAlphaId, "WEATHER");
    const repGammaBefore = await swarmMind.getAgentReputation(agentGammaId, "WEATHER");
    expect(repAlphaBefore).to.equal(0n);
    expect(repGammaBefore).to.equal(0n);

    const initialOwnerBalance = await ethers.provider.getBalance(agentOwner.address);

    // Execute Settle
    const txSettle = await swarmMind.settleSwarm(2);
    await txSettle.wait();

    // 7. Verify Swarm final state
    const s2 = await swarmMind.getSwarm(2);
    expect(s2.state).to.equal(4n); // Settled

    // 8. Verify Bond Handling & Reward Distribution:
    // - ALPHA (predicted 1, correct): bond refunded (0.001) + bounty share
    // - BETA  (predicted 1, correct): bond refunded (0.001) + bounty share
    // - GAMMA (predicted 0, incorrect): bond slashed (0.001) into reward pool!
    // Total pool for correct agents = 0.005 bounty + 0.001 slashed bond = 0.006 MSTC
    // Split equally between Alpha & Beta = 0.003 MSTC each
    // Total payout to agentOwner (owns all 3) = 0.002 (refunded bonds) + 0.006 (rewards) = 0.008 MSTC
    const finalOwnerBalance = await ethers.provider.getBalance(agentOwner.address);
    const payoutReceived = finalOwnerBalance - initialOwnerBalance;
    expect(payoutReceived).to.equal(ethers.parseEther("0.008"));

    // 9. Verify Reputation Updates:
    // - Correct agents (ALPHA, BETA): 0 + 500 = 500 bps (+5.00%)
    const repAlphaAfter = await swarmMind.getAgentReputation(agentAlphaId, "WEATHER");
    const repBetaAfter = await swarmMind.getAgentReputation(agentBetaId, "WEATHER");
    expect(repAlphaAfter).to.equal(500n);
    expect(repBetaAfter).to.equal(500n);

    // - Incorrect agent (GAMMA): 0 - 500 clamped at 0 bps
    const repGammaAfter = await swarmMind.getAgentReputation(agentGammaId, "WEATHER");
    expect(repGammaAfter).to.equal(0n);

    // 10. Verify Swarm #1 is completely preserved and untouched
    const s1 = await swarmMind.getSwarm(1);
    expect(s1.swarmId).to.equal(1n);
    expect(s1.state).to.not.equal(4n); // Swarm #1 is NOT Settled!
    expect(s1.state).to.equal(0n); // Untouched in Created state
  });
});
