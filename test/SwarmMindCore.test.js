const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SwarmMindCore Protocol Tests", function () {
  let SwarmMindCore, swarmMind;
  let MVPControlledResolver, resolver;
  let owner, creator, agent1Owner, agent2Owner, agent3Owner, challenger, outsider;

  // Agent IDs
  const agent1Id = ethers.keccak256(ethers.toUtf8Bytes("WeatherAgent-Alpha"));
  const agent2Id = ethers.keccak256(ethers.toUtf8Bytes("WeatherAgent-Beta"));
  const agent3Id = ethers.keccak256(ethers.toUtf8Bytes("WeatherAgent-Gamma"));
  const financeAgentId = ethers.keccak256(ethers.toUtf8Bytes("FinanceAgent-01"));

  beforeEach(async function () {
    [owner, creator, agent1Owner, agent2Owner, agent3Owner, challenger, outsider] = await ethers.getSigners();

    // Deploy Outcome Resolver
    MVPControlledResolver = await ethers.getContractFactory("MVPControlledResolver");
    resolver = await MVPControlledResolver.deploy();
    await resolver.waitForDeployment();

    // Deploy SwarmMindCore
    SwarmMindCore = await ethers.getContractFactory("SwarmMindCore");
    swarmMind = await SwarmMindCore.deploy();
    await swarmMind.waitForDeployment();
  });

  describe("Phase 1: Agent Registration & Impersonation Prevention", function () {
    it("should successfully register an agent with domain capability", async function () {
      const tx = await swarmMind.connect(agent1Owner).registerAgent(
        agent1Id,
        "WEATHER",
        "ipfs://QmWeatherAlphaMetadata"
      );

      await expect(tx)
        .to.emit(swarmMind, "AgentRegistered")
        .withArgs(agent1Id, agent1Owner.address, "WEATHER", "ipfs://QmWeatherAlphaMetadata");

      const agent = await swarmMind.getAgent(agent1Id);
      expect(agent.owner).to.equal(agent1Owner.address);
      expect(agent.capability).to.equal("WEATHER");
      expect(agent.active).to.be.true;

      // Starting reputation in WEATHER should be 0
      const rep = await swarmMind.getAgentReputation(agent1Id, "WEATHER");
      expect(rep).to.equal(0);
    });

    it("should reject registering duplicate agent IDs", async function () {
      await swarmMind.connect(agent1Owner).registerAgent(
        agent1Id,
        "WEATHER",
        "ipfs://QmWeatherAlphaMetadata"
      );

      await expect(
        swarmMind.connect(agent2Owner).registerAgent(agent1Id, "WEATHER", "ipfs://duplicate")
      ).to.be.revertedWith("SwarmMindCore: agent already registered");
    });

    it("should prevent non-owners from modifying agent status or impersonating", async function () {
      await swarmMind.connect(agent1Owner).registerAgent(
        agent1Id,
        "WEATHER",
        "ipfs://QmWeatherAlphaMetadata"
      );

      await expect(
        swarmMind.connect(outsider).setAgentStatus(agent1Id, false)
      ).to.be.revertedWith("SwarmMindCore: caller is not agent owner");

      // Owner can deactivate and reactivate
      await swarmMind.connect(agent1Owner).setAgentStatus(agent1Id, false);
      let ag = await swarmMind.getAgent(agent1Id);
      expect(ag.active).to.be.false;

      await swarmMind.connect(agent1Owner).setAgentStatus(agent1Id, true);
      ag = await swarmMind.getAgent(agent1Id);
      expect(ag.active).to.be.true;
    });
  });

  describe("Phase 1: Swarm Creation & Agent Selection", function () {
    beforeEach(async function () {
      await swarmMind.connect(agent1Owner).registerAgent(agent1Id, "WEATHER", "ipfs://agent1");
      await swarmMind.connect(agent2Owner).registerAgent(agent2Id, "WEATHER", "ipfs://agent2");
      await swarmMind.connect(agent3Owner).registerAgent(agent3Id, "WEATHER", "ipfs://agent3");
      await swarmMind.connect(agent1Owner).registerAgent(financeAgentId, "FINANCE", "ipfs://finance1");
    });

    it("should create a swarm job and lock bounty in contract escrow", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const commitDeadline = now + 3600;
      const revealDeadline = commitDeadline + 3600;
      const bounty = ethers.parseEther("1.0");
      const minBond = ethers.parseEther("0.1");
      const minChallengeBond = ethers.parseEther("0.05");

      const params = {
        questionHash: "ipfs://QmWillChennaiReceiveRainfallTomorrow",
        requiredCapability: "WEATHER",
        commitDeadline: commitDeadline,
        revealDeadline: revealDeadline,
        requiredAgentCount: 3,
        minBond: minBond,
        minChallengeBond: minChallengeBond,
        outcomeResolver: await resolver.getAddress(),
      };

      const tx = await swarmMind.connect(creator).createSwarm(params, { value: bounty });

      await expect(tx)
        .to.emit(swarmMind, "SwarmCreated")
        .withArgs(
          1,
          creator.address,
          params.questionHash,
          "WEATHER",
          bounty,
          commitDeadline,
          revealDeadline,
          3,
          minBond,
          await resolver.getAddress()
        );

      const contractBalance = await ethers.provider.getBalance(await swarmMind.getAddress());
      expect(contractBalance).to.equal(bounty);

      const swarm = await swarmMind.getSwarm(1);
      expect(swarm.state).to.equal(0); // SwarmState.Created
      expect(swarm.bounty).to.equal(bounty);
    });

    it("should select agents on-chain with capability verification", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        questionHash: "ipfs://QmRainfallQuestion",
        requiredCapability: "WEATHER",
        commitDeadline: now + 3600,
        revealDeadline: now + 7200,
        requiredAgentCount: 3,
        minBond: ethers.parseEther("0.1"),
        minChallengeBond: ethers.parseEther("0.05"),
        outcomeResolver: await resolver.getAddress(),
      };

      await swarmMind.connect(creator).createSwarm(params, { value: ethers.parseEther("1.0") });

      // Cannot select agent with wrong capability (FINANCE vs WEATHER)
      await expect(
        swarmMind.connect(creator).selectAgents(1, [agent1Id, agent2Id, financeAgentId])
      ).to.be.revertedWith("SwarmMindCore: capability mismatch");

      // Successful selection
      const tx = await swarmMind.connect(creator).selectAgents(1, [agent1Id, agent2Id, agent3Id]);
      await expect(tx)
        .to.emit(swarmMind, "AgentsSelected")
        .withArgs(1, [agent1Id, agent2Id, agent3Id]);

      const selected = await swarmMind.getSwarmSelectedAgents(1);
      expect(selected).to.deep.equal([agent1Id, agent2Id, agent3Id]);

      const swarm = await swarmMind.getSwarm(1);
      expect(swarm.state).to.equal(1); // AgentsSelected
    });
  });

  describe("Phase 2 & 3: Commit / Reveal & Prediction Bonds", function () {
    const salt1 = ethers.keccak256(ethers.toUtf8Bytes("salt-agent-1-secret"));
    const salt2 = ethers.keccak256(ethers.toUtf8Bytes("salt-agent-2-secret"));
    const salt3 = ethers.keccak256(ethers.toUtf8Bytes("salt-agent-3-secret"));
    const pred1 = 1; // Yes (rain)
    const conf1 = 8500; // 85%
    const pred2 = 1; // Yes (rain)
    const conf2 = 9200; // 92%
    const pred3 = 0; // No (no rain)
    const conf3 = 7000; // 70%

    let hash1, hash2, hash3;
    const minBond = ethers.parseEther("0.2");

    beforeEach(async function () {
      await swarmMind.connect(agent1Owner).registerAgent(agent1Id, "WEATHER", "ipfs://agent1");
      await swarmMind.connect(agent2Owner).registerAgent(agent2Id, "WEATHER", "ipfs://agent2");
      await swarmMind.connect(agent3Owner).registerAgent(agent3Id, "WEATHER", "ipfs://agent3");

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        questionHash: "ipfs://QmRainfallQuestion",
        requiredCapability: "WEATHER",
        commitDeadline: now + 3600,
        revealDeadline: now + 7200,
        requiredAgentCount: 3,
        minBond: minBond,
        minChallengeBond: ethers.parseEther("0.1"),
        outcomeResolver: await resolver.getAddress(),
      };

      await swarmMind.connect(creator).createSwarm(params, { value: ethers.parseEther("1.0") });
      await swarmMind.connect(creator).selectAgents(1, [agent1Id, agent2Id, agent3Id]);

      hash1 = await swarmMind.computeCommitmentHash(1, agent1Id, pred1, conf1, salt1);
      hash2 = await swarmMind.computeCommitmentHash(1, agent2Id, pred2, conf2, salt2);
      hash3 = await swarmMind.computeCommitmentHash(1, agent3Id, pred3, conf3, salt3);
    });

    it("should enforce prediction bond locking on commit and prevent unauthorized commits", async function () {
      // Outsider cannot commit for agent1
      await expect(
        swarmMind.connect(outsider).commitPrediction(1, agent1Id, hash1, { value: minBond })
      ).to.be.revertedWith("SwarmMindCore: caller is not agent owner");

      // Cannot commit with insufficient bond
      await expect(
        swarmMind.connect(agent1Owner).commitPrediction(1, agent1Id, hash1, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("SwarmMindCore: insufficient prediction bond");

      // Successful commit with locked bond
      const tx = await swarmMind.connect(agent1Owner).commitPrediction(1, agent1Id, hash1, { value: minBond });
      await expect(tx)
        .to.emit(swarmMind, "AgentCommitted")
        .withArgs(1, agent1Id, hash1, minBond);

      const pred = await swarmMind.getPrediction(1, agent1Id);
      expect(pred.committed).to.be.true;
      expect(pred.revealed).to.be.false;
      expect(pred.bondAmount).to.equal(minBond);
    });

    it("should cryptographically verify reveal against commitment and reject altered answers", async function () {
      // Commit all 3 agents
      await swarmMind.connect(agent1Owner).commitPrediction(1, agent1Id, hash1, { value: minBond });
      await swarmMind.connect(agent2Owner).commitPrediction(1, agent2Id, hash2, { value: minBond });
      await swarmMind.connect(agent3Owner).commitPrediction(1, agent3Id, hash3, { value: minBond });

      // Automatically transitions to Revealing when all committed
      const swarmAfterCommit = await swarmMind.getSwarm(1);
      expect(swarmAfterCommit.state).to.equal(2); // Revealing

      // Attempt to reveal with altered prediction value (e.g. changing 1 to 0)
      await expect(
        swarmMind.connect(agent1Owner).revealPrediction(1, agent1Id, 0, conf1, salt1)
      ).to.be.revertedWith("SwarmMindCore: invalid reveal verification");

      // Attempt to reveal with wrong salt
      const fakeSalt = ethers.keccak256(ethers.toUtf8Bytes("wrong-salt"));
      await expect(
        swarmMind.connect(agent1Owner).revealPrediction(1, agent1Id, pred1, conf1, fakeSalt)
      ).to.be.revertedWith("SwarmMindCore: invalid reveal verification");

      // Successful legitimate reveal
      const tx = await swarmMind.connect(agent1Owner).revealPrediction(1, agent1Id, pred1, conf1, salt1);
      await expect(tx)
        .to.emit(swarmMind, "AgentRevealed")
        .withArgs(1, agent1Id, pred1, conf1);

      const pred = await swarmMind.getPrediction(1, agent1Id);
      expect(pred.revealed).to.be.true;
      expect(pred.predictionValue).to.equal(pred1);
      expect(pred.confidence).to.equal(conf1);
    });
  });

  describe("Phase 4, 5, 6 & 7: Challenges, Outcome Resolution, Settlement & Reputation", function () {
    const salt1 = ethers.keccak256(ethers.toUtf8Bytes("salt-1"));
    const salt2 = ethers.keccak256(ethers.toUtf8Bytes("salt-2"));
    const salt3 = ethers.keccak256(ethers.toUtf8Bytes("salt-3"));
    const pred1 = 1; // Rain = Yes
    const conf1 = 9000;
    const pred2 = 1; // Rain = Yes
    const conf2 = 8800;
    const pred3 = 0; // Rain = No (Incorrect prediction!)
    const conf3 = 7500;

    const bounty = ethers.parseEther("1.0");
    const minBond = ethers.parseEther("0.2");
    const challengeBond = ethers.parseEther("0.1");

    beforeEach(async function () {
      await swarmMind.connect(agent1Owner).registerAgent(agent1Id, "WEATHER", "ipfs://agent1");
      await swarmMind.connect(agent2Owner).registerAgent(agent2Id, "WEATHER", "ipfs://agent2");
      await swarmMind.connect(agent3Owner).registerAgent(agent3Id, "WEATHER", "ipfs://agent3");

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const params = {
        questionHash: "ipfs://QmWillChennaiReceiveRainfallTomorrow",
        requiredCapability: "WEATHER",
        commitDeadline: now + 3600,
        revealDeadline: now + 7200,
        requiredAgentCount: 3,
        minBond: minBond,
        minChallengeBond: challengeBond,
        outcomeResolver: await resolver.getAddress(),
      };

      await swarmMind.connect(creator).createSwarm(params, { value: bounty });
      await swarmMind.connect(creator).selectAgents(1, [agent1Id, agent2Id, agent3Id]);

      const h1 = await swarmMind.computeCommitmentHash(1, agent1Id, pred1, conf1, salt1);
      const h2 = await swarmMind.computeCommitmentHash(1, agent2Id, pred2, conf2, salt2);
      const h3 = await swarmMind.computeCommitmentHash(1, agent3Id, pred3, conf3, salt3);

      await swarmMind.connect(agent1Owner).commitPrediction(1, agent1Id, h1, { value: minBond });
      await swarmMind.connect(agent2Owner).commitPrediction(1, agent2Id, h2, { value: minBond });
      await swarmMind.connect(agent3Owner).commitPrediction(1, agent3Id, h3, { value: minBond });

      await swarmMind.connect(agent1Owner).revealPrediction(1, agent1Id, pred1, conf1, salt1);
      await swarmMind.connect(agent2Owner).revealPrediction(1, agent2Id, pred2, conf2, salt2);
      await swarmMind.connect(agent3Owner).revealPrediction(1, agent3Id, pred3, conf3, salt3);
    });

    it("should allow raising a challenge with challenge bond", async function () {
      // Challenger challenges agent3's prediction (claiming radar data shows rainfall)
      const tx = await swarmMind.connect(challenger).challengePrediction(
        1,
        agent3Id,
        "ipfs://QmDopplerRadarShowsHighPrecipitation",
        { value: challengeBond }
      );

      await expect(tx)
        .to.emit(swarmMind, "ChallengeCreated")
        .withArgs(1, 1, agent3Id, challenger.address, challengeBond, "ipfs://QmDopplerRadarShowsHighPrecipitation");

      const ch = await swarmMind.getChallenge(1);
      expect(ch.challenger).to.equal(challenger.address);
      expect(ch.status).to.equal(0); // Pending
    });

    it("should resolve swarm via MVPControlledResolver with deterministic real-world outcome", async function () {
      // Outcome: Chennai received measurable rainfall (1 = Yes)
      const evidence = ethers.toUtf8Bytes("IMD Chennai AWS Station: 14.2mm precipitation recorded");
      await resolver.connect(owner).setOutcome(1, 1, evidence);

      const isRes = await resolver.isResolved(1);
      expect(isRes).to.be.true;

      const tx = await swarmMind.connect(creator).resolveSwarm(1);
      await expect(tx)
        .to.emit(swarmMind, "SwarmResolved")
        .withArgs(1, 1, ethers.hexlify(evidence));

      const swarm = await swarmMind.getSwarm(1);
      expect(swarm.state).to.equal(3); // SwarmState.Resolved
      expect(swarm.finalOutcome).to.equal(1);
    });

    it("should execute smart contract settlement: slash incorrect agent, uphold valid challenge, distribute rewards, and update domain reputation", async function () {
      // 1. Challenger challenges agent3 (who predicted 0 = No)
      await swarmMind.connect(challenger).challengePrediction(
        1,
        agent3Id,
        "ipfs://QmPrecipitationEvidence",
        { value: challengeBond }
      );

      // 2. Resolver sets real-world outcome: 1 (Rain occurred)
      const evidence = ethers.toUtf8Bytes("IMD Chennai Meteorological Center Report: 12.4mm");
      await resolver.connect(owner).setOutcome(1, 1, evidence);
      await swarmMind.resolveSwarm(1);

      // Record pre-settlement balances
      const balanceAgent1Before = await ethers.provider.getBalance(agent1Owner.address);
      const balanceAgent2Before = await ethers.provider.getBalance(agent2Owner.address);
      const balanceAgent3Before = await ethers.provider.getBalance(agent3Owner.address);
      const balanceChallengerBefore = await ethers.provider.getBalance(challenger.address);

      // 3. Settle Swarm
      const settleTx = await swarmMind.settleSwarm(1);

      // Agent 3 should have its prediction bond slashed
      await expect(settleTx)
        .to.emit(swarmMind, "BondSlashed")
        .withArgs(1, agent3Id, minBond);

      // Challenge against agent3 is UPHELD! Challenger receives challenge bond back + bonus
      await expect(settleTx)
        .to.emit(swarmMind, "ChallengeResolved")
        .withArgs(1, 1, 1, challenger.address, (val) => val > challengeBond); // 1 = Upheld

      // Correct agents (1 & 2) receive rewards
      await expect(settleTx).to.emit(swarmMind, "RewardPaid");

      // Verify post-settlement balances
      const balanceAgent1After = await ethers.provider.getBalance(agent1Owner.address);
      const balanceAgent2After = await ethers.provider.getBalance(agent2Owner.address);
      const balanceAgent3After = await ethers.provider.getBalance(agent3Owner.address);
      const balanceChallengerAfter = await ethers.provider.getBalance(challenger.address);

      // Agent 1 & Agent 2 got their bonds returned + reward share
      expect(balanceAgent1After).to.be.gt(balanceAgent1Before);
      expect(balanceAgent2After).to.be.gt(balanceAgent2Before);

      // Agent 3 did NOT get its bond returned (it was slashed)
      expect(balanceAgent3After).to.equal(balanceAgent3Before);

      // Challenger received bond back + challenge bonus
      expect(balanceChallengerAfter).to.be.gt(balanceChallengerBefore);

      // Verify Domain-Specific Reputation updates (Phase 7)
      // Agent 1 & 2 were correct -> Reputation increased by 500 (0.05)
      const repAgent1Weather = await swarmMind.getAgentReputation(agent1Id, "WEATHER");
      const repAgent2Weather = await swarmMind.getAgentReputation(agent2Id, "WEATHER");
      const repAgent3Weather = await swarmMind.getAgentReputation(agent3Id, "WEATHER");

      expect(repAgent1Weather).to.equal(500);
      expect(repAgent2Weather).to.equal(500);
      expect(repAgent3Weather).to.equal(0); // Clamped at 0 (penalty applied)

      // Unrelated domain reputation (e.g. FINANCE) remains isolated at 0
      const repAgent1Finance = await swarmMind.getAgentReputation(agent1Id, "FINANCE");
      expect(repAgent1Finance).to.equal(0);

      const swarm = await swarmMind.getSwarm(1);
      expect(swarm.state).to.equal(4); // SwarmState.Settled
    });

    it("should dismiss invalid challenge and slash challenger bond", async function () {
      // Challenger mistakenly challenges agent1 (who predicted 1 = Rain)
      await swarmMind.connect(challenger).challengePrediction(
        1,
        agent1Id,
        "ipfs://QmFaultyChallenge",
        { value: challengeBond }
      );

      // Resolver confirms 1 (Rain occurred), so agent1 is correct
      await resolver.connect(owner).setOutcome(1, 1, ethers.toUtf8Bytes("Rain recorded"));
      await swarmMind.resolveSwarm(1);

      const balanceChallengerBefore = await ethers.provider.getBalance(challenger.address);

      // Settle
      const settleTx = await swarmMind.settleSwarm(1);

      // Challenge against agent1 is DISMISSED (status = 2)
      await expect(settleTx)
        .to.emit(swarmMind, "ChallengeResolved")
        .withArgs(1, 1, 2, challenger.address, 0); // 2 = Dismissed, 0 payout

      const balanceChallengerAfter = await ethers.provider.getBalance(challenger.address);
      // Challenger did not receive anything back (slashed)
      expect(balanceChallengerAfter).to.equal(balanceChallengerBefore);
    });
  });
});
