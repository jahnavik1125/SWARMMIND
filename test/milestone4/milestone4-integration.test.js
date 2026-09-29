const { expect } = require("chai");
const { ethers } = require("hardhat");
const { compileProblem } = require("../../services/problem-compiler.js");
const { discoverAgents } = require("../../services/agent-registry-client.js");

describe("Milestone 4: End-to-End Problem Compilation, Agent Selection & Swarm Creation", function () {
  let SwarmMindCore, swarmMind;
  let MVPControlledResolver, resolver;
  let owner, creator, agent1Owner, agent2Owner, agent3Owner;

  const agentAlphaId = ethers.id("WEATHER_ALPHA");
  const agentBetaId = ethers.id("WEATHER_BETA");
  const agentGammaId = ethers.id("WEATHER_GAMMA");
  const financeAgentId = ethers.id("FINANCE_AGENT_01");
  const inactiveAgentId = ethers.id("INACTIVE_WEATHER_AGENT");

  beforeEach(async function () {
    [owner, creator, agent1Owner, agent2Owner, agent3Owner] = await ethers.getSigners();

    // Deploy Resolver & Core
    MVPControlledResolver = await ethers.getContractFactory("MVPControlledResolver");
    resolver = await MVPControlledResolver.deploy();
    await resolver.waitForDeployment();

    SwarmMindCore = await ethers.getContractFactory("SwarmMindCore");
    swarmMind = await SwarmMindCore.deploy();
    await swarmMind.waitForDeployment();

    // Register real agents
    await swarmMind.connect(agent1Owner).registerAgent(agentAlphaId, "WEATHER", "ipfs://alpha");
    await swarmMind.connect(agent2Owner).registerAgent(agentBetaId, "WEATHER", "ipfs://beta");
    await swarmMind.connect(agent3Owner).registerAgent(agentGammaId, "WEATHER", "ipfs://gamma");
    await swarmMind.connect(owner).registerAgent(financeAgentId, "FINANCE", "ipfs://finance");

    // Register an inactive agent
    await swarmMind.connect(owner).registerAgent(inactiveAgentId, "WEATHER", "ipfs://inactive");
    await swarmMind.connect(owner).setAgentStatus(inactiveAgentId, false);
  });

  it("1. Problem Compiler: WEATHER question maps to WEATHER capability", function () {
    const compiled = compileProblem("Will it rain in Chennai tomorrow?");
    expect(compiled.capability).to.equal("WEATHER");
    expect(compiled.location).to.equal("Chennai");
    expect(compiled.requiredAgents).to.equal(3);
    expect(compiled.resolutionType).to.equal("WEATHER_OUTCOME");
    expect(compiled.questionHash).to.include("ipfs://");
  });

  it("2. Registry queries: returns all 3 real active WEATHER agents", async function () {
    const allIds = await swarmMind.getAllAgentIds();
    expect(allIds.length).to.equal(5);

    const alpha = await swarmMind.getAgent(agentAlphaId);
    const beta = await swarmMind.getAgent(agentBetaId);
    const gamma = await swarmMind.getAgent(agentGammaId);

    expect(alpha.active).to.be.true;
    expect(beta.active).to.be.true;
    expect(gamma.active).to.be.true;
    expect(alpha.capability).to.equal("WEATHER");
    expect(beta.capability).to.equal("WEATHER");
    expect(gamma.capability).to.equal("WEATHER");
  });

  it("3 & 4. Selection filters: inactive agent and wrong capability are excluded", async function () {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const bounty = ethers.parseEther("0.01");

    const params = {
      questionHash: "ipfs://testQuestion",
      requiredCapability: "WEATHER",
      commitDeadline: now + 3600,
      revealDeadline: now + 7200,
      requiredAgentCount: 3,
      minBond: ethers.parseEther("0.001"),
      minChallengeBond: ethers.parseEther("0.0005"),
      outcomeResolver: await resolver.getAddress()
    };

    await swarmMind.connect(creator).createSwarm(params, { value: bounty });

    // Attempt to select wrong capability (FINANCE)
    await expect(
      swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, financeAgentId])
    ).to.be.revertedWith("SwarmMindCore: capability mismatch");

    // Attempt to select inactive agent
    await expect(
      swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, inactiveAgentId])
    ).to.be.revertedWith("SwarmMindCore: agent not active");
  });

  it("5. Swarm creation succeeds with real bounty escrowed", async function () {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const bounty = ethers.parseEther("0.05");

    const params = {
      questionHash: "ipfs://chennaiRainTomorrow",
      requiredCapability: "WEATHER",
      commitDeadline: now + 86400,
      revealDeadline: now + 172800,
      requiredAgentCount: 3,
      minBond: ethers.parseEther("0.005"),
      minChallengeBond: ethers.parseEther("0.002"),
      outcomeResolver: await resolver.getAddress()
    };

    const tx = await swarmMind.connect(creator).createSwarm(params, { value: bounty });
    await expect(tx).to.emit(swarmMind, "SwarmCreated");

    const swarm = await swarmMind.getSwarm(1);
    expect(swarm.state).to.equal(0); // Created
    expect(swarm.bounty).to.equal(bounty);
    expect(swarm.creator).to.equal(creator.address);

    const contractBal = await ethers.provider.getBalance(await swarmMind.getAddress());
    expect(contractBal).to.equal(bounty);
  });

  it("6 & 7. Selection succeeds and duplicate selection is rejected", async function () {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const bounty = ethers.parseEther("0.01");

    const params = {
      questionHash: "ipfs://chennaiRainTomorrow",
      requiredCapability: "WEATHER",
      commitDeadline: now + 86400,
      revealDeadline: now + 172800,
      requiredAgentCount: 3,
      minBond: ethers.parseEther("0.001"),
      minChallengeBond: ethers.parseEther("0.0005"),
      outcomeResolver: await resolver.getAddress()
    };

    await swarmMind.connect(creator).createSwarm(params, { value: bounty });

    // Attempt duplicate agent in selection array
    await expect(
      swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentAlphaId, agentBetaId])
    ).to.be.revertedWith("SwarmMindCore: duplicate agent selection");

    // Legitimate selection
    const selTx = await swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, agentGammaId]);
    await expect(selTx)
      .to.emit(swarmMind, "AgentsSelected")
      .withArgs(1, [agentAlphaId, agentBetaId, agentGammaId]);

    const swarm = await swarmMind.getSwarm(1);
    expect(swarm.state).to.equal(1); // AgentsSelected

    const selected = await swarmMind.getSwarmSelectedAgents(1);
    expect(selected).to.deep.equal([agentAlphaId, agentBetaId, agentGammaId]);

    // Attempting to select again should fail because state is already AgentsSelected
    await expect(
      swarmMind.connect(creator).selectAgents(1, [agentAlphaId, agentBetaId, agentGammaId])
    ).to.be.revertedWith("SwarmMindCore: swarm not in Created state");
  });

  it("8, 9 & 10. On-chain swarm state matches frontend requirements and receipts exist", async function () {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const bounty = ethers.parseEther("0.01");

    const params = {
      questionHash: "ipfs://bafkreiRainfallChennai",
      requiredCapability: "WEATHER",
      commitDeadline: now + 86400,
      revealDeadline: now + 172800,
      requiredAgentCount: 3,
      minBond: ethers.parseEther("0.001"),
      minChallengeBond: ethers.parseEther("0.0005"),
      outcomeResolver: await resolver.getAddress()
    };

    const tx = await swarmMind.connect(creator).createSwarm(params, { value: bounty });
    const receipt = await tx.wait();

    expect(receipt.status).to.equal(1);
    expect(receipt.hash).to.be.properHex(64);
    expect(receipt.blockNumber).to.be.gt(0);

    const onChainSwarm = await swarmMind.getSwarm(1);
    expect(onChainSwarm.questionHash).to.equal("ipfs://bafkreiRainfallChennai");
    expect(onChainSwarm.requiredCapability).to.equal("WEATHER");
    expect(onChainSwarm.bounty).to.equal(bounty);
  });
});
