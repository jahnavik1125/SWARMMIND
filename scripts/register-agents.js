const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const TARGET_CHAIN_ID = 91562037;

const TARGET_AGENTS = [
  {
    name: "WEATHER_ALPHA",
    id: "0x4f593aa368b69c663a279a652ffdce8e2a7da9526492ac357472105aa758162b",
    capability: "WEATHER",
    metadataUri: "ipfs://bafkreiaweatheralpha01",
    role: "Numerical Weather Prediction & Precipitation Forecaster"
  },
  {
    name: "WEATHER_BETA",
    id: "0x2bb519c2d3835d6116adade05fdda3b9ddf2f4ef94bd343af59a317aee0cb1f4",
    capability: "WEATHER",
    metadataUri: "ipfs://bafkreiaweatherbeta02",
    role: "Atmospheric Moisture Flux & Satellite Radar Forecaster"
  },
  {
    name: "WEATHER_GAMMA",
    id: "0x2d9cbf004444d64e839bc520559f8047edd707a24ee15171f56648797edad560",
    capability: "WEATHER",
    metadataUri: "ipfs://bafkreiaweathergamma03",
    role: "Microclimate Analyst & Climatological Critic"
  }
];

function getArtifact(subPath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", subPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function main() {
  console.log("============================================================");
  console.log("  SWARMMIND REAL AGENT REGISTRATION CLI (MST TESTNET)      ");
  console.log("============================================================");

  const deployedPath = path.join(__dirname, "..", "deployed-contracts.json");
  if (!fs.existsSync(deployedPath)) {
    console.error("deployed-contracts.json not found!");
    process.exit(1);
  }

  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const coreAddress = deployed.contracts.SwarmMindCore.address;
  console.log(`Target SwarmMindCore : ${coreAddress}`);
  console.log(`Deployer / Owner     : ${deployed.deployer}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== TARGET_CHAIN_ID) {
    throw new Error(`Chain ID mismatch! Expected ${TARGET_CHAIN_ID} but got ${net.chainId}`);
  }

  const coreArtifact = getArtifact(path.join("SwarmMindCore.sol", "SwarmMindCore.json"));
  const readCore = new ethers.Contract(coreAddress, coreArtifact.abi, provider);

  // Check on-chain agent status
  console.log("\nChecking existing on-chain agents...");
  for (const target of TARGET_AGENTS) {
    try {
      const ag = await readCore.getAgent(target.id);
      if (ag.registeredAt > 0) {
        console.log(`[ALREADY REGISTERED] ${target.name} (Owner: ${ag.owner}, Capability: ${ag.capability})`);
      }
    } catch {
      console.log(`[PENDING] ${target.name} is not registered yet.`);
    }
  }

  // Check if CLI signer exists
  const tempWalletPath = path.join(__dirname, "..", ".temp-deployer.json");
  let signer = null;

  if (fs.existsSync(tempWalletPath)) {
    const tempWalletData = JSON.parse(fs.readFileSync(tempWalletPath, "utf8"));
    const w = new ethers.Wallet(tempWalletData.privateKey, provider);
    const bal = await provider.getBalance(w.address);
    if (bal > 0n) {
      console.log(`Using funded temporary CLI deployer: ${w.address} (Balance: ${ethers.formatEther(bal)} MSTC)`);
      signer = w;
    }
  }

  if (!signer) {
    console.log("\n------------------------------------------------------------");
    console.log("NOTICE: Browser Wallet Signing Recommended");
    console.log("Your primary BridgeKey wallet owns the protocol contracts.");
    console.log("Please open the safe deployment dashboard to register agents:");
    console.log("--> http://localhost:3333/");
    console.log("Click 'Register Agents' to sign safely via BridgeKey.");
    console.log("------------------------------------------------------------");
    return;
  }

  // If CLI signer is available:
  const writeCore = new ethers.Contract(coreAddress, coreArtifact.abi, signer);
  const registeredFile = path.join(__dirname, "..", "registered-agents.json");
  let registeredData = { network: "mstTestnet", chainId: TARGET_CHAIN_ID, agents: {} };
  if (fs.existsSync(registeredFile)) {
    registeredData = JSON.parse(fs.readFileSync(registeredFile, "utf8"));
  }

  for (const target of TARGET_AGENTS) {
    try {
      const ag = await readCore.getAgent(target.id);
      if (ag.registeredAt > 0) continue;
    } catch {
      // not registered, proceed
    }

    console.log(`\nRegistering ${target.name}...`);
    console.log(`  Agent ID    : ${target.id}`);
    console.log(`  Capability  : ${target.capability}`);
    console.log(`  Metadata URI: ${target.metadataUri}`);

    const tx = await writeCore.registerAgent(target.id, target.capability, target.metadataUri);
    console.log(`  Tx Hash     : ${tx.hash}`);
    console.log(`  Explorer    : https://testnet.mstscan.com/tx/${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    registeredData.agents[target.name] = {
      agentId: target.id,
      capability: target.capability,
      metadataUri: target.metadataUri,
      role: target.role,
      owner: signer.address,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      registeredAt: new Date().toISOString(),
      explorerUrl: `https://testnet.mstscan.com/tx/${tx.hash}`
    };

    fs.writeFileSync(registeredFile, JSON.stringify(registeredData, null, 2));
  }

  console.log("\nAll agents registered. Running verification...");
  const { main: verify } = require("./verify-agents");
  await verify();
}

main().catch(err => {
  console.error("Agent registration failed:", err);
  process.exit(1);
});
