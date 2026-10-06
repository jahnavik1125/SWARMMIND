# 🧠 SwarmMind — Agent-Native Blockchain Protocol

> **“We don’t ask which AI to trust. We build a system where AI agents have to earn trust.”**

<div align="center">

[![MST Testnet](https://img.shields.io/badge/MST_Testnet-Chain_91562037-22d3ee?style=for-the-badge&logo=blockchain)](https://testnet.mstscan.com)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.19-6366f1?style=for-the-badge&logo=solidity)](https://soliditylang.org/)
[![Ethers.js](https://img.shields.io/badge/Ethers.js-v6-f59e0b?style=for-the-badge)](https://docs.ethers.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-84cc16?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-slate?style=for-the-badge)](LICENSE)

</div>

---

## 🌐 Live Protocol & Verified Deployments

- **🚀 Live Application (GitHub Pages):** **[https://jahnavik1125.github.io/SWARMMIND/](https://jahnavik1125.github.io/SWARMMIND/)**
- **📦 GitHub Repository:** **[https://github.com/jahnavik1125/SWARMMIND](https://github.com/jahnavik1125/SWARMMIND)**
- **⚡ 1-Click Vercel Deployment:** [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjahnavik1125%2FSWARMMIND)

### ⛓️ Deployed Smart Contracts (MST Testnet — Chain ID `91562037`)

| Contract | Address | Explorer Link |
|---|---|---|
| **`SwarmMindCore.sol`** | `0x92283AA6983D52A8A3bEa714D5FD8cc6Db360276` | [View on MSTScan ↗](https://testnet.mstscan.com/address/0x92283AA6983D52A8A3bEa714D5FD8cc6Db360276) |
| **`MVPControlledResolver.sol`** | `0x4d1E37b71Dfd3794Efe856E2A9D74D7ed28B9234` | [View on MSTScan ↗](https://testnet.mstscan.com/address/0x4d1E37b71Dfd3794Efe856E2A9D74D7ed28B9234) |

```
Network Name : MST Blockchain Testnet
Chain ID     : 91562037 (0x5751ca9)
RPC URL      : https://testnetrpc.mstblockchain.com
Explorer     : https://testnet.mstscan.com
Deployer     : 0x3730145b513129B6081d753882536871ea454d46
```

---

## 💡 What is SwarmMind?

SwarmMind is a **blockchain-first protocol for autonomous AI accountability**. Instead of relying on a single centralized LLM or blind trust, SwarmMind coordinates multiple specialized AI agents that must **stake financial bonds (`MSTC`)**, **cryptographically commit their reasoning**, **cross-examine peers in an adversarial challenge market**, and **settle on-chain upon empirical ground-truth verification**.

```
  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
  │  Problem Input  │ ────> │ Multi-Agent     │ ────> │  Keccak256      │
  │  (Natural Lang) │       │ Selection       │       │  Commit & Bond  │
  └─────────────────┘       └─────────────────┘       └─────────────────┘
                                                               │
  ┌─────────────────┐       ┌─────────────────┐                ▼
  │ On-Chain Trust  │ <──── │ Ground Truth    │ <──── ┌─────────────────┐
  │ & Payout Update │       │ Oracle Gate     │       │ Reveal & Debate │
  └─────────────────┘       └─────────────────┘       │ Consensus Graph │
                                                      └─────────────────┘
```

---

## 🎯 Key Pillars & Protocol Architecture

### 1. 🔐 Cryptographic Commit-Reveal Scheme
- Prevents last-minute front-running and copycat agent collusion.
- **Commit Phase:** Agents hash their prediction, secret nonce, and identifier:
  $$\text{commitHash} = \text{keccak256}(\text{abi.encodePacked}(\text{prediction}, \text{nonce}, \text{agentId}))$$
  The hash is anchored on-chain with a locked bond ($0.0010\text{ MSTC}$).
- **Reveal Phase:** Agents submit raw values; the smart contract verifies bytecode match before accepting.

### 2. 💰 Bond Escrow & Stake Alignment
- Every agent puts economic **skin-in-the-game**.
- Creator funds a bounty pool (e.g., $0.0050\text{ MSTC}$).
- Correct agents earn: $\text{Full Bond Refund} + \text{Pro-Rata Bounty Share} + 500\text{ bps (+5.00%) Reputation Boost}$.
- Incorrect agents forfeit their bond to the slashing pool and incur a $-500\text{ bps (-5.00%)}$ reputation penalty.

### 3. ⚔️ Adversarial Peer Review & Challenge Market
- Agents cross-examine methodologies (e.g., boundary layer atmospheric models vs geostationary satellite water-vapor advection).
- Unsubstantiated claims can be challenged with on-chain evidence stakes.

### 4. 🛡️ 5-Gate Oracle Safety System
Settlement is gated against premature or forecast-only inputs:
1. **Target Date Concluded**: Realized timestamp must be reached.
2. **Non-Forecast Source**: Only empirical historical station observations allowed for resolution.
3. **Observation Recorded**: Physical gauge/sensor data logged.
4. **Reproducible Evidence**: Evidence hash anchored.
5. **Authorized Resolver**: `MVPControlledResolver` validates authorization on `SwarmMindCore`.

---

## 🤖 Registered On-Chain Agents

| Agent Name | Agent ID Hash | Domain Specialization | Base Rep |
|---|---|---|---|
| `WEATHER_ALPHA` | `0x4f593aa368b69c663a279a652ffdce8e2a7da9526492ac357472105aa758162b` | Numerical Weather Prediction (ECMWF/GFS) | 88% |
| `WEATHER_BETA` | `0x2bb519c2d3835d6116adade05fdda3b9ddf2f4ef94bd343af59a317aee0cb1f4` | Satellite Moisture Flux (INSAT-3DR) | 86% |
| `WEATHER_GAMMA` | `0x2d9cbf004444d64e839bc520559f8047edd707a24ee15171f56648797edad560` | Coastal Boundary Layer & Convective Instability | 91% |

---

## 📜 On-Chain Verification Trail (Live Receipts on MST Testnet)

| Protocol Action | Transaction Hash | Block Number |
|---|---|---|
| **Deploy MVPControlledResolver** | `0x26b0accb938c823069151578b7a4be46db984852c035650aa0626a27e7caa29d` | `5786336` |
| **Deploy SwarmMindCore** | `0xadaf2570775d7870f7b58832a8292f768b556b66a5bc39922e4c4be674be7b08` | `5786342` |
| **Register WEATHER_GAMMA** | `0x6b9a3667c4ec2646d84aa3a758782ee91a3297a76e01a613897ca49aa6027ab1` | `5786518` |
| **Register WEATHER_ALPHA** | `0xfe05a2fe21262d98dc2157ecad68a3e74b39b0ee7fc390232fa0a9e70196c3f0` | `5786530` |
| **Register WEATHER_BETA** | `0x3f28fe16a85817d23d8c1157bca18804918e7d727b13766ea9d05e26ec259a36` | `5786539` |
| **Create Swarm #1** | `0xfdfe37452d3a3d52cb3e4307a68571477ea08d24b6f128e93290e29b19e2fa04` | `5786741` |
| **Select Swarm Agents** | `0x61c9b6dca0b171638202efd33939634e3204938a923507fb02ee538fe0a9c13e` | `5786744` |
| **Commit WEATHER_ALPHA** | `0xaf132b26e94c80dab59b97aba539f7e9c1222183fa5349162db11ed7b8544cd2` | `5786998` |
| **Commit WEATHER_BETA** | `0x807423482efc8911e9d14b70fb323522b30c965fb9750b97dae8148bb993fbb3` | `5787001` |
| **Commit WEATHER_GAMMA** | `0x735ba75645267922877235ae3a07d376e76b41e890b3769ed61b779a333b3616` | `5787004` |
| **Reveal WEATHER_ALPHA (YES 60%)** | `0xa15a3ebb895556e7d802accfa43c4a83ca6456ecdb69f64e5bf79981d16ca087` | `5787247` |
| **Reveal WEATHER_BETA (YES 58%)** | `0xdb6194f685cd953ed262c3d8735433d555feee1d9e540a778b0c74fffad8e9be` | `5787251` |
| **Reveal WEATHER_GAMMA (YES 73%)** | `0xdba3f80be0bee04e346b942822cc24595d1a623764737d26be9ff950c9fe6d2f` | `5787254` |

---

## 🛠️ Repository Structure

```
SwarmMind/
├── contracts/                     # Solidity Smart Contracts
│   ├── SwarmMindCore.sol          # Main protocol: agents, bonds, commit-reveal, reputation
│   ├── interfaces/
│   │   └── IOutcomeResolver.sol   # Modular resolver interface standard
│   └── resolvers/
│       └── MVPControlledResolver.sol  # Controlled empirical oracle resolver
│
├── agents/                        # Autonomous AI Agent Reasoning Modules
│   ├── weather-alpha/agent.js     # Atmospheric physics model
│   ├── weather-beta/agent.js      # Satellite moisture flux model
│   └── weather-gamma/agent.js     # Microclimate convective critic
│
├── services/                      # Protocol Coordination & Consensus Engines
│   ├── swarm-coordinator.js       # End-to-end swarm lifecycle orchestrator
│   ├── blockchain-service.js      # MST Testnet Ethers.js integration layer
│   ├── problem-compiler.js        # Natural language parameter deconstructor
│   ├── consensus-engine.js        # Reputation-weighted probability synthesis
│   ├── debate-engine.js           # Adversarial challenge market logic
│   └── outcome-service.js         # Settlement & trust score updater
│
├── frontend/deploy/
│   └── index.html                 # Synaptic Neural Network Protocol Control Center
│
├── scripts/                       # Hardhat Deployment & Verification Scripts
│   ├── deploy.js                  # Automated contract deployment
│   ├── register-agents.js         # On-chain agent registration script
│   ├── deployment-server.js       # Local development & API server (port 3333)
│   └── verify-*.js                # Milestone validation suites
│
├── test/                          # Mocha/Chai Protocol Integration Tests
│   ├── SwarmMindCore.test.js      # Smart contract unit tests
│   └── milestone4-9/              # Verification gate test suites
│
├── hardhat.config.js              # Hardhat configuration with MST Testnet network
└── vercel.json                    # One-click static deployment configuration
```

---

## 🚀 Quick Start & Local Execution

### 1. Prerequisites
- **Node.js** 18+
- **Git**
- **MetaMask / EVM Injected Wallet** (configured with MST Testnet)

### 2. Installation & Setup
```bash
# Clone repository
git clone https://github.com/jahnavik1125/SWARMMIND.git
cd SWARMMIND

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
```

### 3. Run Protocol Control Center
```bash
node scripts/deployment-server.js
```
Open **`http://localhost:3333`** in your browser to access the interactive Protocol Control Center.

### 4. Run Test Suite
```bash
npx hardhat test
```

---

## ⚖️ Technical Highlights & Design Tradeoffs

| Feature | Implementation | Benefit |
|---|---|---|
| **Front-Running Immunity** | Keccak256 Commit-Reveal Scheme | Agents cannot observe peer forecasts before committing |
| **Economic Skin-in-the-Game** | Mandatory Bond Staking ($0.0010\text{ MSTC}$) | Disincentivizes low-quality or hallucinated outputs |
| **Decentralized Verification** | EVM Smart Contracts on MST Testnet | Audit trail is immutable and publicly inspectable |
| **Zero-Collusion Isolation** | Independent Agent Reasoning Modules | Preserves ensemble diversity across scientific domains |
| **MVP Scope** | Controlled Resolver (`MVPControlledResolver`) | Provides safe, deterministic test verification before decentralized oracle networks |

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
