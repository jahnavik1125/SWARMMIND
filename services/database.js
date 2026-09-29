const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "swarmmind-db.json");
const AGENT_REGISTRY_FILE = path.join(DATA_DIR, "agent-registry.json");
const DATA_SOURCES_FILE = path.join(DATA_DIR, "data-sources.json");

function getDefaultDb() {
  const initialAgents = JSON.parse(fs.readFileSync(AGENT_REGISTRY_FILE, "utf8"));
  const initialSources = JSON.parse(fs.readFileSync(DATA_SOURCES_FILE, "utf8"));

  // Seed with realistic completed predictions demonstrating the accountability loop
  const initialSwarms = [
    {
      swarmId: "hist-01",
      question: "Will it rain in Chennai on September 28, 2026?",
      domain: "weather",
      requiredDomains: ["weather"],
      selectedAgents: ["weather_physics_01", "weather_cloud_02", "weather_historical_03"],
      createdAt: "2026-09-27T10:15:00Z",
      resolvedAt: "2026-09-28T18:00:00Z",
      status: "RESOLVED",
      finalOutcome: "YES",
      groundTruthEvidence: "IMD Nungambakkam AWS recorded 6.4mm accumulated precipitation.",
      consensus: {
        predictionText: "YES",
        confidence: 82,
        agreement: "Moderate Agreement",
        factors: [
          "ERA5 atmospheric moisture flux from Bay of Bengal",
          "SEVIR radar indicated deep convective bands",
          "WeatherBench 30-year analogues indicated 68% probability"
        ]
      },
      agentResults: [
        {
          agentId: "weather_physics_01",
          name: "Physics Weather Agent",
          prediction: "YES",
          confidence: 84,
          isCorrect: true,
          reputationDelta: 5,
          blockchainTx: "0x6b9a3667d217c7b72190243c4003ab167335308d132761fa03a7b08c60adcab1"
        },
        {
          agentId: "weather_cloud_02",
          name: "Cloud / Satellite Agent",
          prediction: "YES",
          confidence: 81,
          isCorrect: true,
          reputationDelta: 5,
          blockchainTx: "0x3f28fe16015c27ed299be03bd5d3c0c506267b078276a7b59bcf3b3fffc89a36"
        },
        {
          agentId: "weather_historical_03",
          name: "Historical Weather / ML Agent",
          prediction: "YES",
          confidence: 76,
          isCorrect: true,
          reputationDelta: 5,
          blockchainTx: "0xfe05a2fe129a1130aacb0339e4d5dfbb7747517115bc47e1508677df12dec3f0"
        }
      ]
    },
    {
      swarmId: "hist-02",
      question: "Should we build an elevated pedestrian skywalk over MG Road?",
      domain: "infrastructure",
      requiredDomains: ["infrastructure", "environment", "risk"],
      selectedAgents: ["infra_structural_01", "infra_cost_02", "env_terrain_02", "risk_cross_domain_01"],
      createdAt: "2026-09-25T14:30:00Z",
      resolvedAt: "2026-09-27T11:00:00Z",
      status: "RESOLVED",
      finalOutcome: "APPROVED_WITH_CONDITIONS",
      groundTruthEvidence: "Municipal Technical Review Committee approved with pier soil reinforcement.",
      consensus: {
        predictionText: "FEASIBLE (With foundation risk mitigation)",
        confidence: 81,
        agreement: "High Agreement",
        factors: [
          "FHWA NBI archetype confirms standard 42m steel box girder feasibility",
          "Unit cost estimated at $850/m² within civic budget limits",
          "Risk Agent flagged utility line collisions under northern pier"
        ]
      },
      agentResults: [
        {
          agentId: "infra_structural_01",
          name: "Infrastructure Agent",
          prediction: "FEASIBLE",
          confidence: 84,
          isCorrect: true,
          reputationDelta: 4,
          blockchainTx: "0x892a014bc56ef01827493a105829375019385018375019283740192837401928"
        },
        {
          agentId: "risk_cross_domain_01",
          name: "Cross-Domain Risk Agent",
          prediction: "HIGH RISK (Utility lines)",
          confidence: 88,
          isCorrect: true,
          reputationDelta: 5,
          blockchainTx: "0x1298401928301928301928301928301928301928301928301928301928301928"
        }
      ]
    }
  ];

  return {
    agents: initialAgents,
    dataSources: initialSources,
    swarms: initialSwarms,
    reputationAuditLog: [
      {
        timestamp: "2026-09-28T18:05:00Z",
        swarmId: "hist-01",
        agentId: "weather_physics_01",
        domain: "weather",
        oldReputation: 86,
        newReputation: 91,
        delta: 5,
        reason: "Accurate precipitation forecast confirmed by ground truth rain gauge."
      }
    ]
  };
}

class Database {
  constructor() {
    this.init();
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const defaultData = getDefaultDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), "utf8");
    }
  }

  load() {
    try {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      return JSON.parse(raw);
    } catch {
      const defaultData = getDefaultDb();
      this.save(defaultData);
      return defaultData;
    }
  }

  save(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
  }

  getAgents() {
    const db = this.load();
    return db.agents || [];
  }

  getAgentById(agentId) {
    const agents = this.getAgents();
    return agents.find(a => a.agent_id === agentId);
  }

  getDataSources() {
    const db = this.load();
    return db.dataSources || [];
  }

  getSwarms() {
    const db = this.load();
    return db.swarms || [];
  }

  getSwarmById(swarmId) {
    const swarms = this.getSwarms();
    return swarms.find(s => String(s.swarmId) === String(swarmId));
  }

  saveSwarm(swarm) {
    const db = this.load();
    const idx = db.swarms.findIndex(s => String(s.swarmId) === String(swarm.swarmId));
    if (idx >= 0) {
      db.swarms[idx] = swarm;
    } else {
      db.swarms.unshift(swarm);
    }
    this.save(db);
    return swarm;
  }

  updateAgentReputation(agentId, domain, delta, reason = "") {
    const db = this.load();
    const agent = db.agents.find(a => a.agent_id === agentId);
    if (!agent) return null;

    const oldGlobal = agent.current_reputation;
    const oldDomain = agent.domain_reputation[domain] || agent.current_reputation;

    const newDomain = Math.min(100, Math.max(0, oldDomain + delta));
    agent.domain_reputation[domain] = newDomain;

    // Recalculate global reputation as weighted average of domains
    const domainScores = Object.values(agent.domain_reputation);
    const avgScore = Math.round(domainScores.reduce((a, b) => a + b, 0) / domainScores.length);
    agent.current_reputation = avgScore;

    if (delta > 0) {
      agent.successful_predictions = (agent.successful_predictions || 0) + 1;
    } else if (delta < 0) {
      agent.failed_predictions = (agent.failed_predictions || 0) + 1;
    }
    agent.number_of_predictions = (agent.successful_predictions || 0) + (agent.failed_predictions || 0);

    const logEntry = {
      timestamp: new Date().toISOString(),
      agentId,
      domain,
      oldReputation: oldDomain,
      newReputation: newDomain,
      delta,
      reason
    };

    db.reputationAuditLog = db.reputationAuditLog || [];
    db.reputationAuditLog.unshift(logEntry);

    this.save(db);
    return { agent, logEntry };
  }

  resetToDefault() {
    const defaultData = getDefaultDb();
    this.save(defaultData);
    return defaultData;
  }
}

module.exports = new Database();
