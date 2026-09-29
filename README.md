# 🧠 SwarmMind — Autonomous AI Accountability Protocol

> **Decentralized swarm intelligence on the MST Testnet blockchain. AI agents make predictions, stake bonds, challenge each other, and settle outcomes — all on-chain.**

<div align="center">

![SwarmMind](https://img.shields.io/badge/SwarmMind-v1.0.0-6366f1?style=for-the-badge&logo=ethereum)
![MST Testnet](https://img.shields.io/badge/MST_Testnet-Chain_91562037-22d3ee?style=for-the-badge)
![Solidity](https://img.shields.io/badge/Solidity-^0.8.19-e2e8f0?style=for-the-badge&logo=solidity)
![Node.js](https://img.shields.io/badge/Node.js-18+-84cc16?style=for-the-badge&logo=node.js)

</div>

---

## 📖 What is SwarmMind?

SwarmMind is an **autonomous AI accountability protocol** that coordinates multiple AI agents to collaboratively make predictions, then holds them accountable via:

- 🔐 **Commit-reveal cryptography** — agents commit hashed predictions before revealing, preventing manipulation
- 💰 **Bond staking** — agents stake `MSTC` tokens as skin-in-the-game
- ⚖️ **Challenge market** — agents can challenge each other's methodology with evidence
- 🏆 **Reputation settlement** — correct agents earn reputation + bond rewards; wrong ones lose
- 🔗 **On-chain accountability** — every step anchored to MST Testnet blockchain

---

## 🌐 Live Deployment

### Smart Contracts (MST Testnet)

| Contract | Address |
|---|---|
| `SwarmMindCore.sol` | [`0x92283AA6983D52A8A3bEa714D5FD8cc6Db360276`](https://testnet.mstscan.io/address/0x92283AA6983D52A8A3bEa714D5FD8cc6Db360276) |
| `MVPControlledResolver.sol` | [`0x4d1E37b71Dfd3794Efe856E2A9D74D7ed28B9234`](https://testnet.mstscan.io/address/0x4d1E37b71Dfd3794Efe856E2A9D74D7ed28B9234) |

### Network Config

```
Network:  MST Testnet
Chain ID: 91562037
RPC URL:  https://testnetrpc.mstblockchain.com
```

### On-Chain Transaction History

| Event | Tx Hash | Block |
|---|---|---|
| Deploy `MVPControlledResolver` | `0x26b0accb...a29d` | `5786336` |
| Deploy `SwarmMindCore` | `0xadaf2570...e7b08` | `5786342` |
| Register `WEATHER_GAMMA` | `0x6b9a3667...ab1` | `5786518` |
| Register `WEATHER_ALPHA` | `0xfe05a2fe...c3f0` | `5786530` |
| Register `WEATHER_BETA` | `0x3f28fe16...9a36` | `5786539` |
| Create Swarm #1 | `0xfdfe3745...fa04` | `5786741` |
| Select Agents | `0x61c9b6dc...c13e` | `5786744` |
| WEATHER_ALPHA Commit | `0xaf132b26...cd2` | `5786998` |
| WEATHER_BETA Commit | `0x80742348...bb3` | `5787001` |
| WEATHER_GAMMA Commit | `0x735ba756...616` | `5787004` |
| WEATHER_ALPHA Reveal → YES 60% | `0xa15a3ebb...087` | `5787247` |
| WEATHER_BETA Reveal → YES 58% | `0xdb6194f6...9be` | `5787251` |
| WEATHER_GAMMA Reveal → YES 73% | `0xdba3f80b...2f` | `5787254` |

---

## 🤖 Registered Agents

| Agent | Agent ID | Domain | Reputation |
|---|---|---|---|
| `WEATHER_ALPHA` | `0x4f593aa3...162b` | Atmospheric Science | 88% |
| `WEATHER_BETA` | `0x2bb519c2...1f4` | Numerical Weather Prediction | 85% |
| `WEATHER_GAMMA` | `0x2d9cbf00...d560` | Satellite Data Analysis | 91% |

---

## 🏗️ Architecture

```
SwarmMind/
├── contracts/                     # Solidity smart contracts
│   ├── SwarmMindCore.sol          # Core protocol: agents, swarms, commit-reveal
│   ├── interfaces/
│   │   └── IOutcomeResolver.sol   # Resolver interface
│   └── resolvers/
│       └── MVPControlledResolver.sol  # Controlled outcome resolver
│
├── agents/                        # AI agent implementations
│   ├── weather-alpha/agent.js
│   ├── weather-beta/agent.js
│   └── weather-gamma/agent.js
│
├── services/                      # Backend protocol services
│   ├── swarm-coordinator.js       # Orchestrates full swarm lifecycle
│   ├── blockchain-service.js      # MST Testnet interactions (ethers.js)
│   ├── problem-compiler.js        # Parses natural language → structured problem
│   ├── agent-engine.js            # Agent prediction generation
│   ├── commitment-store.js        # Commit-reveal storage
│   ├── consensus-engine.js        # Aggregates predictions into consensus
│   ├── debate-engine.js           # Challenge market logic
│   ├── outcome-service.js         # Settlement + reputation delta
│   └── database.js                # In-memory + JSON persistence
│
├── frontend/deploy/
│   └── index.html                 # Full-stack single-page app (no framework)
│
├── scripts/
│   ├── deploy.js                  # Hardhat deploy to MST Testnet
│   ├── register-agents.js         # On-chain agent registration
│   ├── deployment-server.js       # Node.js HTTP server (port 3333)
│   └── verify-*.js                # Blockchain verification scripts
│
├── data/                          # Agent registry + oracle data sources
├── metadata/                      # Agent metadata (IPFS-ready JSON)
├── test/                          # Mocha test suites (milestones 4–9)
└── hardhat.config.js              # Hardhat + MST Testnet config
```

---

## 🔄 11-Stage Protocol Flow

```
Stage 01 — Problem Compilation        Natural language → structured prediction task
Stage 02 — Agent Recruitment          Filter agents by domain, reputation, stake
Stage 03 — Data Sourcing              16 oracle feeds polled (weather, satellite, etc.)
Stage 04 — Commit & Bonds             Agents commit hash(prediction + nonce), stake MSTC
Stage 05 — Challenge Market           Agents challenge peers with on-chain evidence
Stage 06 — Reveal                     Agents reveal prediction + nonce; hash verified
Stage 07 — Consensus Formation        Weighted aggregation → final YES/NO + confidence %
Stage 08 — Debate Resolution          Challenge rulings finalized
Stage 09 — Outcome Settlement         Real-world outcome submitted to resolver
Stage 10 — Reputation Update          +5% correct / -5% wrong, bond payouts
Stage 11 — Audit Trail                Full immutable on-chain history
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Git
- MetaMask (for on-chain interactions)

### Install

```bash
git clone https://github.com/jahnavik1125/SWARMMIND.git
cd SWARMMIND
npm install
```

### Configure Environment

```bash
cp .env.example .env
# Edit .env and set:
# PRIVATE_KEY=your_deployer_private_key
# MST_RPC_URL=https://testnetrpc.mstblockchain.com
```

### Run the Protocol Control Center

```bash
node scripts/deployment-server.js
```

Then open **http://localhost:3333** in your browser.

### Deploy Contracts (optional — already deployed)

```bash
npx hardhat run scripts/deploy.js --network mstTestnet
```

### Register Agents (optional — already registered)

```bash
node scripts/register-agents.js
```

---

## 🖥️ Frontend — Protocol Control Center

The frontend is a single `index.html` with zero build-step dependencies. It features:

### Landing Page Tabs

| Tab | Description |
|---|---|
| **🌐 Summoner Arena** | Submit a natural language prediction task and watch the swarm execute |
| **🤖 Agent Registry** | Browse all registered AI agents, filter by domain, view reputation bars |
| **📡 Data Sources** | 16 live oracle feeds (NOAA, IMD, ECMWF, satellite, IoT sensors) |
| **📜 Prediction Ledger** | Full history of all past swarms with outcomes |
| **🔗 MST Testnet** | Contract explorer, copy addresses, add MST Testnet to MetaMask |

### Neural Canvas Animation

- 11 animated stage cards with live status indicators
- Real-time progress through the protocol lifecycle
- Commit/reveal cryptographic proof display
- Challenge market event cards
- Consensus confidence meter
- Reputation delta visualization

---

## 📡 API Reference

The deployment server exposes these REST endpoints:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/network-status` | MST Testnet sync status + block number |
| `POST` | `/api/swarm/run` | Execute a full swarm prediction |
| `GET` | `/api/platform/swarms` | List all swarms from DB |
| `GET` | `/api/platform/agents` | List all registered agents |
| `GET` | `/api/platform/data-sources` | List all oracle data sources |
| `POST` | `/api/swarm/:id/resolve` | Submit real-world outcome for settlement |

---

## 🧪 Test Suite

```bash
# Run all milestone tests
npm test

# Individual milestones
npx mocha test/milestone4/milestone4-integration.test.js
npx mocha test/milestone5/milestone5-commitments.test.js
npx mocha test/milestone6/milestone6-reveal.test.js
npx mocha test/milestone7/milestone7-challenge.test.js
npx mocha test/milestone8/milestone8-settlement.test.js
npx mocha test/milestone9/milestone9-settlement-gate.test.js
```

---

## ⚙️ Smart Contract — SwarmMindCore.sol

### Key Functions

```solidity
// Register an AI agent on-chain
function registerAgent(bytes32 agentId, string memory metadataURI) external

// Create a new prediction swarm
function createSwarm(bytes32 swarmId, string memory question) external

// Commit a hashed prediction (Stage 04)
function commitPrediction(bytes32 swarmId, bytes32 commitHash) external

// Reveal prediction + nonce (Stage 06)
function revealPrediction(bytes32 swarmId, bool prediction, uint256 nonce) external

// Settle outcome via resolver (Stage 09)
function settleOutcome(bytes32 swarmId) external
```

---

## 🔐 Commit-Reveal Scheme

```
Commit Phase:
  commitHash = keccak256(abi.encodePacked(prediction, nonce, agentId))
  → Submitted on-chain — no one can see the prediction

Reveal Phase:
  prediction + nonce submitted → contract verifies hash matches
  → Prevents agents from changing prediction after seeing others
```

---

## 💡 Pros & Cons

### ✅ Pros
- **Tamper-proof** — commit-reveal prevents last-minute manipulation
- **Stake-aligned** — agents lose bonds for wrong predictions
- **Decentralized** — no single point of trust or failure
- **Transparent** — every action on MST Testnet explorer
- **Extensible** — plug in any oracle, any domain resolver
- **Gamified accountability** — reputation system creates long-term incentives

### ⚠️ Cons / Limitations
- **MST Testnet only** — not yet on mainnet
- **Centralized outcome input** — `MVPControlledResolver` accepts manual outcome entry (MVP design)
- **No Sybil resistance** — agent registration is permissionless (by design for MVP)
- **Gas costs** — commit + reveal + settle = 3 on-chain txs per agent per swarm
- **Oracle latency** — real-world data feeds are simulated in current data layer

---

## 🏆 Swarm #1 — Live Case Study

**Question:** *"Will Chennai receive more than 50mm of rainfall in the next 24 hours?"*

**Agents:** WEATHER_ALPHA, WEATHER_BETA, WEATHER_GAMMA  
**Bonds:** `0.0010 MSTC` each + `0.0050 MSTC` bounty pool  
**Challenge:** WEATHER_GAMMA challenged WEATHER_ALPHA on boundary layer physics methodology → **Target hypothesis upheld**

**Results:**
| Agent | Prediction | Confidence |
|---|---|---|
| WEATHER_ALPHA | YES | 60% |
| WEATHER_BETA | YES | 58% |
| WEATHER_GAMMA | YES | 73% |

**Consensus:** YES (63.7% weighted confidence) — `OUTCOME_PENDING` / `SETTLEMENT LOCKED`

---

## 📄 License

MIT © 2026 SwarmMind

---

<div align="center">
  <b>Built on MST Testnet · Powered by ethers.js · Zero framework frontend</b>
</div>
