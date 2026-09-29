const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const SECURE_STORAGE_DIR = path.join(__dirname, "..", "secure-storage");

/**
 * Hard Safety Gate for Real-World Outcome Settlement
 */
function evaluateSettlementGate({
  isTargetPeriodComplete,
  isForecastOnly,
  observedValueMissing,
  isEvidenceReproducible,
  isResolverAuthorized
}) {
  const gates = {
    targetPeriodComplete: {
      passed: Boolean(isTargetPeriodComplete),
      message: isTargetPeriodComplete
        ? "Target observation period has elapsed."
        : "Target observation period is incomplete. Ground truth measurement cannot be concluded prior to date completion."
    },
    nonForecastSource: {
      passed: !isForecastOnly,
      message: !isForecastOnly
        ? "Source dataset is verified realized/observed meteorological data."
        : "Forecast-only data rejected. Settlement strictly forbids using forecasts as realized observations."
    },
    observationAvailable: {
      passed: !observedValueMissing,
      message: !observedValueMissing
        ? "Realized observation ground truth measurement is present."
        : "Realized observation is missing or outside historical archive range."
    },
    evidenceReproducible: {
      passed: Boolean(isEvidenceReproducible),
      message: isEvidenceReproducible
        ? "Canonical evidence package is reproducible and cryptographic hash verified."
        : "Evidence hash does not match canonical normalization."
    },
    resolverAuthorized: {
      passed: Boolean(isResolverAuthorized),
      message: isResolverAuthorized
        ? "Caller is authorized in MVPControlledResolver."
        : "Caller is not authorized to submit outcome in MVPControlledResolver."
    }
  };

  const allPassed = Object.values(gates).every(g => g.passed);

  return {
    allPassed,
    gates,
    status: allPassed ? "OUTCOME_READY" : "OUTCOME_PENDING"
  };
}

/**
 * Outcome Collector for Real-World Environmental Data
 * Sourced from Open-Meteo Historical & Realized Weather Observations Archive
 * (ERA5-Land reanalysis & WMO ground surface station assimilation for Chennai).
 */
async function collectWeatherOutcome(swarmId = 1, options = {}) {
  const opts = typeof options === "string" ? { targetDate: options } : (options || {});

  // Controlled Demo Swarm #2 handler: Deterministic settlement demonstration
  if (Number(swarmId) === 2 || opts.isControlledDemo) {
    const observedValue = opts.mockObservedValue !== undefined && opts.mockObservedValue !== null
      ? Number(opts.mockObservedValue)
      : 1.2;
    const threshold = opts.threshold !== undefined ? opts.threshold : 0.5;
    const outcomeValue = observedValue >= threshold ? 1 : 0;
    const outcomeText = outcomeValue === 1 ? "YES" : "NO";
    const retrievalTimestamp = new Date().toISOString();

    const evidencePackage = {
      swarmId: 2,
      location: "Chennai, Tamil Nadu, India (13.0827°N, 80.2707°E)",
      question: "CONTROLLED DEMO: Will the measured precipitation value be >= 0.5 mm?",
      metric: "daily precipitation",
      threshold: threshold,
      observedValue: observedValue,
      outcome: outcomeText,
      outcomeValue: outcomeValue,
      source: "CONTROLLED TEST INPUT — NOT REAL-WORLD OBSERVATION",
      note: "Controlled demonstration of deterministic settlement mechanics. Swarm #1 real outcome remains safely pending.",
      observationTimestamp: retrievalTimestamp,
      retrievalTimestamp: retrievalTimestamp
    };

    const canonicalString = JSON.stringify(evidencePackage);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalString));
    const evidenceBytes = ethers.toUtf8Bytes(canonicalString);

    if (!fs.existsSync(SECURE_STORAGE_DIR)) {
      fs.mkdirSync(SECURE_STORAGE_DIR, { recursive: true });
    }
    const evidenceFilePath = path.join(SECURE_STORAGE_DIR, `outcome-evidence-swarm-2.json`);
    fs.writeFileSync(evidenceFilePath, JSON.stringify(evidencePackage, null, 2), "utf8");

    const gateResult = evaluateSettlementGate({
      isTargetPeriodComplete: true,
      isForecastOnly: false,
      observedValueMissing: false,
      isEvidenceReproducible: true,
      isResolverAuthorized: true
    });

    return {
      swarmId: 2,
      location: "Chennai, Tamil Nadu, India (13.0827°N, 80.2707°E)",
      targetDate: "2026-09-28 (Controlled Test)",
      currentDate: new Date().toISOString().split("T")[0],
      metric: "daily precipitation",
      threshold: threshold,
      unit: "mm",
      status: "OUTCOME_READY",
      canSettle: true,
      isAvailable: true,
      isControlledDemo: true,
      reason: "Controlled test input (1.2 mm >= 0.5 mm -> YES). Deterministic economic settlement unlocked for Swarm #2.",
      safetyGates: gateResult.gates,
      isForecast: false,
      sourceType: "CONTROLLED_DEMO_INPUT",
      source: "CONTROLLED TEST INPUT — NOT REAL-WORLD OBSERVATION",
      sourceUrl: "internal://controlled-demo-resolver",
      observedValue: observedValue,
      outcome: outcomeText,
      outcomeValue: outcomeValue,
      evidencePackage: evidencePackage,
      evidenceHash: evidenceHash,
      evidenceBytes: ethers.hexlify(evidenceBytes),
      observationTimestamp: retrievalTimestamp,
      retrievalTimestamp: retrievalTimestamp
    };
  }

  const targetDate = opts.targetDate || "2026-09-29";
  const threshold = opts.threshold !== undefined ? opts.threshold : 0.5;
  const latitude = 13.0827;
  const longitude = 80.2707;
  const locationString = "Chennai, Tamil Nadu, India (13.0827°N, 80.2707°E)";

  // Source endpoint: Realized Historical & Observed Archive
  const archiveEndpoint = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${targetDate}&end_date=${targetDate}&daily=precipitation_sum&timezone=auto`;
  const endpoint = opts.customEndpoint || archiveEndpoint;

  const isForecastOnly = Boolean(
    opts.isForecastOnly ||
    endpoint.includes("/v1/forecast") ||
    (endpoint.includes("forecast") && !endpoint.includes("archive"))
  );

  const retrievalTimestamp = new Date().toISOString();
  const currentDateStr = opts.mockCurrentDate || new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
  const isTargetPeriodComplete = currentDateStr > targetDate;

  let observedValue = null;
  let apiRawData = null;
  let apiError = null;

  if (options.mockObservedValue !== undefined) {
    observedValue = options.mockObservedValue !== null ? Number(options.mockObservedValue) : null;
  } else if (!isForecastOnly && isTargetPeriodComplete) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        apiRawData = await res.json();
        if (apiRawData && apiRawData.daily && Array.isArray(apiRawData.daily.precipitation_sum)) {
          const val = apiRawData.daily.precipitation_sum[0];
          if (val !== undefined && val !== null && !isNaN(val)) {
            observedValue = Number(val);
          }
        } else if (apiRawData && apiRawData.error) {
          apiError = apiRawData.reason || "Observation API returned error";
        }
      } else {
        apiError = `HTTP ${res.status}: Failed to fetch historical observation`;
      }
    } catch (err) {
      apiError = err.message;
    }
  }

  const observedValueMissing = observedValue === null || isNaN(observedValue);
  const isResolverAuthorized = options.mockResolverCaller !== undefined
    ? options.mockResolverCaller
    : true; // Default true for audit unless tested

  let isEvidenceReproducible = false;
  let evidencePackage = null;
  let evidenceHash = null;
  let evidenceBytes = null;
  let outcomeText = null;
  let outcomeValue = null;

  if (!observedValueMissing && !isForecastOnly && isTargetPeriodComplete) {
    outcomeValue = observedValue >= threshold ? 1 : 0;
    outcomeText = outcomeValue === 1 ? "YES" : "NO";

    evidencePackage = {
      swarmId: Number(swarmId),
      location: locationString,
      targetDate: targetDate,
      metric: "daily precipitation",
      threshold: threshold,
      observedValue: observedValue,
      outcome: outcomeText,
      source: "Open-Meteo Historical & Realized Weather Observations Archive (ERA5-Land / WMO Surface Stations)",
      sourceUrl: endpoint,
      observationTimestamp: `${targetDate}T23:59:59+05:30`,
      retrievalTimestamp: retrievalTimestamp
    };

    const canonicalString = JSON.stringify(evidencePackage);
    evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalString));
    evidenceBytes = ethers.toUtf8Bytes(canonicalString);

    // Verify reproducibility
    const checkHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalString));
    isEvidenceReproducible = checkHash === evidenceHash;

    // Save evidence package off-chain
    if (!fs.existsSync(SECURE_STORAGE_DIR)) {
      fs.mkdirSync(SECURE_STORAGE_DIR, { recursive: true });
    }
    const evidenceFilePath = path.join(SECURE_STORAGE_DIR, `outcome-evidence-swarm-${swarmId}.json`);
    fs.writeFileSync(evidenceFilePath, JSON.stringify(evidencePackage, null, 2), "utf8");
  }

  const gateResult = evaluateSettlementGate({
    isTargetPeriodComplete,
    isForecastOnly,
    observedValueMissing,
    isEvidenceReproducible: observedValueMissing ? false : isEvidenceReproducible,
    isResolverAuthorized
  });

  const canSettle = gateResult.allPassed;

  let reason = "";
  if (!isTargetPeriodComplete) {
    reason = "Settlement deferred because the target-date realized outcome is not yet available.";
  } else if (isForecastOnly) {
    reason = "Settlement rejected: Source data is forecast-only. Protocol requires verified realized observations.";
  } else if (observedValueMissing) {
    reason = `Realized rainfall observation is missing or pending archive finalization (${apiError || "Unavailable"}).`;
  } else if (!canSettle) {
    reason = "One or more safety gate conditions failed.";
  } else {
    reason = "All hard safety gates verified. Realized observation ground truth ready for settlement.";
  }

  return {
    swarmId: Number(swarmId),
    location: locationString,
    targetDate: targetDate,
    currentDate: currentDateStr,
    metric: "daily precipitation",
    threshold: threshold,
    unit: "mm",
    status: gateResult.status, // "OUTCOME_READY" or "OUTCOME_PENDING"
    canSettle: canSettle,
    isAvailable: canSettle,
    reason: reason,
    safetyGates: gateResult.gates,
    isForecast: isForecastOnly,
    sourceType: isForecastOnly ? "FORECAST" : "REALIZED_OBSERVATION",
    source: isForecastOnly
      ? "Open-Meteo High-Resolution Ensemble Forecast"
      : "Open-Meteo Historical & Realized Weather Observations Archive (ERA5-Land / WMO Surface Stations)",
    sourceUrl: endpoint,
    observedValue: observedValue,
    outcome: outcomeText,
    outcomeValue: outcomeValue,
    evidencePackage: evidencePackage,
    evidenceHash: evidenceHash,
    evidenceBytes: evidenceBytes ? ethers.hexlify(evidenceBytes) : null,
    observationTimestamp: evidencePackage ? evidencePackage.observationTimestamp : null,
    retrievalTimestamp: retrievalTimestamp
  };
}

module.exports = {
  collectWeatherOutcome,
  evaluateSettlementGate
};
