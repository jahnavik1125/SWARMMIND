const { expect } = require("chai");
const { ethers } = require("hardhat");
const crypto = require("crypto");
const { collectWeatherOutcome, evaluateSettlementGate } = require("../../services/outcome-collector.js");

describe("Milestone 9: Final Real Outcome Collection & Settlement Hard Safety Gate", function () {
  let SwarmMindCore, swarmMind;
  let MVPControlledResolver, resolver;
  let owner, creator, agentOwner, challenger, unauthorized;

  const agentAlphaId = ethers.id("WEATHER_ALPHA");
  const agentBetaId = ethers.id("WEATHER_BETA");
  const agentGammaId = ethers.id("WEATHER_GAMMA");

  const minBond = ethers.parseEther("0.001");
  const minChallengeBond = ethers.parseEther("0.0005");
  const bounty = ethers.parseEther("0.005");

  // Alpha & Beta predict YES (1), Gamma predicts NO (0)
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

  beforeEach(async function () {
    [owner, creator, agentOwner, challenger, unauthorized] = await ethers.getSigners();

    MVPControlledResolver = await ethers.getContractFactory("MVPControlledResolver");
    resolver = await MVPControlledResolver.deploy();
    await resolver.waitForDeployment();

    SwarmMindCore = await ethers.getContractFactory("SwarmMindCore");
    swarmMind = await SwarmMindCore.deploy();
    await swarmMind.waitForDeployment();

    // Register agents
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

    // Create Swarm #1 (Bounty 0.005 MSTC)
    await swarmMind.connect(creator).createSwarm(params, { value: bounty });
    await swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, agentGammaId]);

    // Commit all 3
    await swarmMind.connect(agentOwner).commitPrediction(1, agentAlphaId, alphaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentBetaId, betaHash, { value: minBond });
    await swarmMind.connect(agentOwner).commitPrediction(1, agentGammaId, gammaHash, { value: minBond });

    // Reveal all 3
    await swarmMind.connect(agentOwner).revealPrediction(1, agentAlphaId, alphaPred, alphaConf, alphaSalt);
    await swarmMind.connect(agentOwner).revealPrediction(1, agentBetaId, betaPred, betaConf, betaSalt);
    await swarmMind.connect(agentOwner).revealPrediction(1, agentGammaId, gammaPred, gammaConf, gammaSalt);
  });

  describe("Safety Gate Unit Tests", function () {
    it("1. Incomplete target period blocks settlement", async function () {
      // Current date 2026-09-28 < target date 2026-09-29
      const result = await collectWeatherOutcome(1, {
        mockCurrentDate: "2026-09-28",
        targetDate: "2026-09-29"
      });

      expect(result.canSettle).to.be.false;
      expect(result.status).to.equal("OUTCOME_PENDING");
      expect(result.safetyGates.targetPeriodComplete.passed).to.be.false;
      expect(result.reason).to.include("Settlement deferred because the target-date realized outcome is not yet available.");
    });

    it("2. Forecast-only data blocks settlement", async function () {
      // Attempting to resolve using forecast endpoint or forecast flag
      const result = await collectWeatherOutcome(1, {
        mockCurrentDate: "2026-09-30",
        targetDate: "2026-09-29",
        isForecastOnly: true,
        customEndpoint: "https://api.open-meteo.com/v1/forecast?daily=precipitation_sum"
      });

      expect(result.canSettle).to.be.false;
      expect(result.status).to.equal("OUTCOME_PENDING");
      expect(result.safetyGates.nonForecastSource.passed).to.be.false;
      expect(result.reason).to.include("forecast-only");
    });

    it("3. Missing observation blocks settlement", async function () {
      // Elapsed date but no observation recorded in archive
      const result = await collectWeatherOutcome(1, {
        mockCurrentDate: "2026-09-30",
        targetDate: "2026-09-29",
        mockObservedValue: null
      });

      expect(result.canSettle).to.be.false;
      expect(result.status).to.equal("OUTCOME_PENDING");
      expect(result.safetyGates.observationAvailable.passed).to.be.false;
      expect(result.reason).to.include("missing");
    });

    it("4. Valid realized observation permits resolution (OUTCOME_READY)", async function () {
      // 2026-09-30, realized archive observation 1.4 mm >= 0.5 mm -> YES
      const result = await collectWeatherOutcome(1, {
        mockCurrentDate: "2026-09-30",
        targetDate: "2026-09-29",
        threshold: 0.5,
        mockObservedValue: 1.4
      });

      expect(result.canSettle).to.be.true;
      expect(result.status).to.equal("OUTCOME_READY");
      expect(result.outcome).to.equal("YES");
      expect(result.outcomeValue).to.equal(1);
      expect(result.evidenceHash).to.be.a("string");
      expect(result.evidenceBytes).to.be.a("string");
      expect(result.safetyGates.targetPeriodComplete.passed).to.be.true;
      expect(result.safetyGates.nonForecastSource.passed).to.be.true;
      expect(result.safetyGates.observationAvailable.passed).to.be.true;
      expect(result.safetyGates.evidenceReproducible.passed).to.be.true;
      expect(result.safetyGates.resolverAuthorized.passed).to.be.true;
    });
  });

  describe("On-Chain Settlement Verification with Realized Outcome Pipeline", function () {
    it("5. Resolver authorization: unauthorized address cannot set outcome", async function () {
      const outcomeVal = 1;
      const dummyEvidence = ethers.toUtf8Bytes("evidence");

      await expect(
        resolver.connect(unauthorized).setOutcome(1, outcomeVal, dummyEvidence)
      ).to.be.revertedWith("MVPControlledResolver: unauthorized");
    });

    it("6. Full settlement lifecycle: correct/incorrect classification, bonds, bounty, reputation and final state", async function () {
      // Collect valid realized outcome
      const outcomeData = await collectWeatherOutcome(1, {
        mockCurrentDate: "2026-09-30",
        targetDate: "2026-09-29",
        threshold: 0.5,
        mockObservedValue: 1.8 // >= 0.5mm -> YES (outcomeValue: 1)
      });

      expect(outcomeData.status).to.equal("OUTCOME_READY");

      // 1. setOutcome on MVPControlledResolver
      const txSet = await resolver.connect(owner).setOutcome(
        1,
        outcomeData.outcomeValue,
        outcomeData.evidenceBytes
      );
      await txSet.wait();

      expect(await resolver.isResolved(1)).to.be.true;

      // 2. resolveSwarm on SwarmMindCore
      const txResolve = await swarmMind.resolveSwarm(1);
      await txResolve.wait();

      let swarm = await swarmMind.getSwarm(1);
      expect(swarm.state).to.equal(3n); // Resolved
      expect(swarm.finalOutcome).to.equal(1n);

      // Record pre-settlement balance & reputation
      const agentOwnerBalanceBefore = await ethers.provider.getBalance(agentOwner.address);
      const repAlphaBefore = await swarmMind.getAgentReputation(agentAlphaId, "WEATHER");
      const repBetaBefore = await swarmMind.getAgentReputation(agentBetaId, "WEATHER");
      const repGammaBefore = await swarmMind.getAgentReputation(agentGammaId, "WEATHER");

      expect(repAlphaBefore).to.equal(0n);
      expect(repBetaBefore).to.equal(0n);
      expect(repGammaBefore).to.equal(0n);

      // 3. settleSwarm on SwarmMindCore
      const txSettle = await swarmMind.settleSwarm(1);
      await txSettle.wait();

      // Verify Final Swarm State
      swarm = await swarmMind.getSwarm(1);
      expect(swarm.state).to.equal(4n); // Settled

      // Verify Reputation Updates
      // Alpha & Beta were correct (predicted 1): 0 + 500 = 500 bps
      const repAlphaAfter = await swarmMind.getAgentReputation(agentAlphaId, "WEATHER");
      const repBetaAfter = await swarmMind.getAgentReputation(agentBetaId, "WEATHER");
      expect(repAlphaAfter).to.equal(500n);
      expect(repBetaAfter).to.equal(500n);

      // Gamma was incorrect (predicted 0): 0 - 500 clamped at 0
      const repGammaAfter = await swarmMind.getAgentReputation(agentGammaId, "WEATHER");
      expect(repGammaAfter).to.equal(0n);

      // Verify Bond & Bounty Accounting
      // Alpha & Beta get bond refund: 2 * 0.001 = 0.002 MSTC
      // Gamma bond slashed: 0.001 MSTC added to reward pool
      // Distributable reward pool = 0.005 bounty + 0.001 slashed bond = 0.006 MSTC
      // Split between Alpha and Beta (equal rep): 0.003 MSTC each
      // Total received by agentOwner = 0.002 (bonds) + 0.006 (bounty & slashed bond) = 0.008 MSTC
      const agentOwnerBalanceAfter = await ethers.provider.getBalance(agentOwner.address);
      const balanceDiff = agentOwnerBalanceAfter - agentOwnerBalanceBefore;
      expect(balanceDiff).to.equal(ethers.parseEther("0.008"));

      // Contract escrow balance must be exactly 0 after complete settlement
      const coreBalance = await ethers.provider.getBalance(await swarmMind.getAddress());
      expect(coreBalance).to.equal(0n);
    });
  });
});
