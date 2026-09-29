const crypto = require("crypto");

/**
 * Problem Compiler for SwarmMind
 * Analyzes natural language questions and extracts structured requirements
 * without arbitrary text generation.
 */

const WEATHER_KEYWORDS = [
  "rain", "rainfall", "precipitation", "weather", "temperature",
  "monsoon", "humidity", "storm", "cyclone", "wind", "forecast"
];

const KNOWN_LOCATIONS = [
  "chennai", "mumbai", "delhi", "bengaluru", "kolkata",
  "hyderabad", "pune", "ahmedabad", "london", "tokyo", "new york"
];

function compileProblem(rawQuestion) {
  if (!rawQuestion || typeof rawQuestion !== "string") {
    throw new Error("Invalid question input");
  }

  const cleaned = rawQuestion.trim();
  const lower = cleaned.toLowerCase();

  // 1. Capability classification
  let capability = null;
  const isWeather = WEATHER_KEYWORDS.some(kw => lower.includes(kw));
  if (isWeather) {
    capability = "WEATHER";
  } else if (lower.includes("stock") || lower.includes("price") || lower.includes("btc") || lower.includes("finance")) {
    capability = "FINANCE";
  } else if (lower.includes("solar") || lower.includes("photovoltaic") || lower.includes("irradiance")) {
    capability = "SOLAR";
  } else {
    throw new Error(`Unresolvable capability: no specialized registry exists for question: "${cleaned}"`);
  }

  // 2. Location extraction
  let location = "Chennai"; // default target
  for (const loc of KNOWN_LOCATIONS) {
    if (lower.includes(loc)) {
      location = loc.charAt(0).toUpperCase() + loc.slice(1);
      break;
    }
  }

  // 3. Target Date determination
  const now = new Date();
  let targetDate = new Date(now.getTime() + 86400000); // default tomorrow
  if (lower.includes("today")) {
    targetDate = now;
  } else if (lower.includes("day after tomorrow")) {
    targetDate = new Date(now.getTime() + 172800000);
  }

  const formattedDate = targetDate.toISOString().split("T")[0];

  // 4. Deterministic Question Hash (CID/hash representation)
  const questionDigest = crypto
    .createHash("sha256")
    .update(`${cleaned}:${location}:${formattedDate}`)
    .digest("hex");
  const questionHash = `ipfs://bafkrei${questionDigest.slice(0, 32)}`;

  return {
    question: cleaned,
    capability: capability,
    location: location,
    targetDate: formattedDate,
    resolutionType: "WEATHER_OUTCOME",
    requiredAgents: 3,
    confidenceThreshold: 0.50,
    questionHash: questionHash,
    isMeasurable: true,
    compiledAt: new Date().toISOString()
  };
}

module.exports = { compileProblem };
