// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IOutcomeResolver.sol";

/**
 * @title SwarmMindCore
 * @notice Core protocol coordinator for SwarmMind on MST Blockchain Testnet.
 * Coordinates autonomous AI agents, prediction bonds, cryptographic commit/reveal,
 * challenge markets, deterministic outcome resolution, and domain-specific reputation.
 */
contract SwarmMindCore is Ownable, ReentrancyGuard {
    using Address for address payable;

    // Constants
    uint256 public constant MAX_REPUTATION = 10000; // 100.00%
    uint256 public constant BASE_REPUTATION_WEIGHT = 100; // Minimum baseline weight for distribution
    uint256 public constant REPUTATION_SUCCESS_BOOST = 500; // +5.00% on correct prediction
    uint256 public constant REPUTATION_FAILURE_PENALTY = 500; // -5.00% on incorrect prediction
    uint256 public constant REPUTATION_NO_REVEAL_PENALTY = 1000; // -10.00% for failing to reveal

    enum SwarmState {
        Created,
        AgentsSelected,
        Revealing,
        Resolved,
        Settled,
        Cancelled
    }

    enum ChallengeStatus {
        Pending,
        Upheld,
        Dismissed
    }

    struct Agent {
        bytes32 agentId;
        address owner;
        string capability;
        string metadataUri;
        uint256 registeredAt;
        bool active;
    }

    struct PredictionCommitment {
        bytes32 commitmentHash;
        uint256 bondAmount;
        bool committed;
        bool revealed;
        int256 predictionValue;
        uint256 confidence;
        uint256 committedAt;
        uint256 revealedAt;
    }

    struct Swarm {
        uint256 swarmId;
        address creator;
        string questionHash;
        string requiredCapability;
        uint256 bounty;
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 requiredAgentCount;
        uint256 minBond;
        uint256 minChallengeBond;
        address outcomeResolver;
        SwarmState state;
        bytes32[] selectedAgents;
        int256 finalOutcome;
        bytes resolutionEvidence;
        uint256 totalBonded;
        uint256 createdAt;
    }

    struct CreateSwarmParams {
        string questionHash;
        string requiredCapability;
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 requiredAgentCount;
        uint256 minBond;
        uint256 minChallengeBond;
        address outcomeResolver;
    }

    struct Challenge {
        uint256 challengeId;
        uint256 swarmId;
        bytes32 targetAgentId;
        address challenger;
        uint256 challengeBond;
        string evidenceHash;
        ChallengeStatus status;
        uint256 createdAt;
    }

    // Storage
    uint256 public nextSwarmId = 1;
    uint256 public nextChallengeId = 1;

    // Agents
    mapping(bytes32 => Agent) public agents;
    bytes32[] public allAgentIds;
    mapping(address => bytes32[]) private _ownerAgents;

    // Domain-Specific Reputation: agentId => capability => reputation score (0 - 10000)
    mapping(bytes32 => mapping(string => uint256)) public agentDomainReputation;
    mapping(bytes32 => uint256) public agentTotalPredictions;
    mapping(bytes32 => uint256) public agentCorrectPredictions;

    // Swarms
    mapping(uint256 => Swarm) public swarms;
    mapping(uint256 => mapping(bytes32 => bool)) public isAgentSelectedInSwarm;
    mapping(uint256 => mapping(bytes32 => PredictionCommitment)) public swarmPredictions;

    // Challenges
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => uint256[]) public swarmChallengeIds;
    mapping(uint256 => mapping(bytes32 => uint256)) public predictionChallengeCount;

    // Events
    event AgentRegistered(
        bytes32 indexed agentId,
        address indexed owner,
        string capability,
        string metadataUri
    );

    event AgentStatusUpdated(bytes32 indexed agentId, bool active);

    event SwarmCreated(
        uint256 indexed swarmId,
        address indexed creator,
        string questionHash,
        string requiredCapability,
        uint256 bounty,
        uint256 commitDeadline,
        uint256 revealDeadline,
        uint256 requiredAgentCount,
        uint256 minBond,
        address outcomeResolver
    );

    event AgentsSelected(uint256 indexed swarmId, bytes32[] selectedAgentIds);

    event AgentCommitted(
        uint256 indexed swarmId,
        bytes32 indexed agentId,
        bytes32 commitmentHash,
        uint256 bondAmount
    );

    event AgentRevealed(
        uint256 indexed swarmId,
        bytes32 indexed agentId,
        int256 predictionValue,
        uint256 confidence
    );

    event ChallengeCreated(
        uint256 indexed challengeId,
        uint256 indexed swarmId,
        bytes32 indexed targetAgentId,
        address challenger,
        uint256 challengeBond,
        string evidenceHash
    );

    event ChallengeResolved(
        uint256 indexed challengeId,
        uint256 indexed swarmId,
        ChallengeStatus status,
        address indexed challenger,
        uint256 rewardOrSlash
    );

    event SwarmResolved(
        uint256 indexed swarmId,
        int256 outcomeValue,
        bytes evidence
    );

    event PredictionSettled(
        uint256 indexed swarmId,
        bytes32 indexed agentId,
        bool isCorrect,
        uint256 reward,
        uint256 returnedBond
    );

    event RewardPaid(
        uint256 indexed swarmId,
        address indexed recipient,
        uint256 amount
    );

    event BondSlashed(
        uint256 indexed swarmId,
        bytes32 indexed agentId,
        uint256 slashedAmount
    );

    event ReputationUpdated(
        bytes32 indexed agentId,
        string indexed capability,
        uint256 oldReputation,
        uint256 newReputation
    );

    event SwarmSettled(
        uint256 indexed swarmId,
        uint256 totalRewardsDistributed,
        uint256 totalSlashedBonds
    );

    event SwarmCancelled(uint256 indexed swarmId, string reason);

    modifier onlyAgentOwner(bytes32 agentId) {
        require(agents[agentId].registeredAt > 0, "SwarmMindCore: agent does not exist");
        require(agents[agentId].owner == msg.sender, "SwarmMindCore: caller is not agent owner");
        _;
    }

    constructor() Ownable(msg.sender) {}

    // =============================================================
    //                    PHASE 1: AGENT REGISTRY
    // =============================================================

    /**
     * @notice Register an autonomous AI agent with specific capability and metadata.
     * @param agentId Unique identifier for the agent.
     * @param capability Domain capability (e.g., "WEATHER", "FINANCE", "SOLAR", "CLIMATE", "RISK").
     * @param metadataUri URI or hash pointing to off-chain profile/model specifications.
     */
    function registerAgent(
        bytes32 agentId,
        string calldata capability,
        string calldata metadataUri
    ) external {
        require(agentId != bytes32(0), "SwarmMindCore: invalid agentId");
        require(agents[agentId].registeredAt == 0, "SwarmMindCore: agent already registered");
        require(bytes(capability).length > 0, "SwarmMindCore: empty capability");

        agents[agentId] = Agent({
            agentId: agentId,
            owner: msg.sender,
            capability: capability,
            metadataUri: metadataUri,
            registeredAt: block.timestamp,
            active: true
        });

        allAgentIds.push(agentId);
        _ownerAgents[msg.sender].push(agentId);

        // Initial domain reputation starts at 0
        agentDomainReputation[agentId][capability] = 0;

        emit AgentRegistered(agentId, msg.sender, capability, metadataUri);
    }

    function setAgentStatus(bytes32 agentId, bool active) external onlyAgentOwner(agentId) {
        agents[agentId].active = active;
        emit AgentStatusUpdated(agentId, active);
    }

    function getAgent(bytes32 agentId) external view returns (Agent memory) {
        require(agents[agentId].registeredAt > 0, "SwarmMindCore: agent not found");
        return agents[agentId];
    }

    function getAllAgentIds() external view returns (bytes32[] memory) {
        return allAgentIds;
    }

    function getAgentsByOwner(address owner) external view returns (bytes32[] memory) {
        return _ownerAgents[owner];
    }

    // =============================================================
    //                    PHASE 1: SWARM CREATION
    // =============================================================

    /**
     * @notice Create a problem solving job / swarm and deposit escrow bounty.
     * @param params Struct containing swarm parameters.
     */
    function createSwarm(
        CreateSwarmParams calldata params
    ) external payable nonReentrant returns (uint256 swarmId) {
        require(msg.value > 0, "SwarmMindCore: bounty must be greater than zero");
        require(params.commitDeadline > block.timestamp, "SwarmMindCore: invalid commit deadline");
        require(params.revealDeadline > params.commitDeadline, "SwarmMindCore: invalid reveal deadline");
        require(params.requiredAgentCount > 0, "SwarmMindCore: required agents must be > 0");

        swarmId = nextSwarmId++;

        Swarm storage s = swarms[swarmId];
        s.swarmId = swarmId;
        s.creator = msg.sender;
        s.questionHash = params.questionHash;
        s.requiredCapability = params.requiredCapability;
        s.bounty = msg.value;
        s.commitDeadline = params.commitDeadline;
        s.revealDeadline = params.revealDeadline;
        s.requiredAgentCount = params.requiredAgentCount;
        s.minBond = params.minBond;
        s.minChallengeBond = params.minChallengeBond;
        s.outcomeResolver = params.outcomeResolver;
        s.state = SwarmState.Created;
        s.createdAt = block.timestamp;

        emit SwarmCreated(
            swarmId,
            msg.sender,
            params.questionHash,
            params.requiredCapability,
            msg.value,
            params.commitDeadline,
            params.revealDeadline,
            params.requiredAgentCount,
            params.minBond,
            params.outcomeResolver
        );
    }

    /**
     * @notice Record selected agents on-chain.
     * Selected agents are verified for capability and active status.
     */
    function selectAgents(
        uint256 swarmId,
        bytes32[] calldata selectedAgentIds
    ) external {
        Swarm storage swarm = swarms[swarmId];
        require(swarm.creator != address(0), "SwarmMindCore: swarm does not exist");
        require(
            msg.sender == swarm.creator || msg.sender == owner(),
            "SwarmMindCore: unauthorized recruiter"
        );
        require(swarm.state == SwarmState.Created, "SwarmMindCore: swarm not in Created state");
        require(
            selectedAgentIds.length == swarm.requiredAgentCount,
            "SwarmMindCore: agent count mismatch"
        );

        for (uint256 i = 0; i < selectedAgentIds.length; i++) {
            bytes32 aId = selectedAgentIds[i];
            Agent memory ag = agents[aId];
            require(ag.registeredAt > 0, "SwarmMindCore: unverified agent");
            require(ag.active, "SwarmMindCore: agent not active");
            require(
                keccak256(bytes(ag.capability)) == keccak256(bytes(swarm.requiredCapability)),
                "SwarmMindCore: capability mismatch"
            );
            require(!isAgentSelectedInSwarm[swarmId][aId], "SwarmMindCore: duplicate agent selection");

            isAgentSelectedInSwarm[swarmId][aId] = true;
        }

        swarm.selectedAgents = selectedAgentIds;
        swarm.state = SwarmState.AgentsSelected;

        emit AgentsSelected(swarmId, selectedAgentIds);
    }

    // =============================================================
    //             PHASE 2 & 3: COMMIT / REVEAL & BONDS
    // =============================================================

    /**
     * @notice Helper to compute the cryptographic commitment hash.
     * Bound to: (swarmId, agentId, predictionValue, confidence, salt).
     */
    function computeCommitmentHash(
        uint256 swarmId,
        bytes32 agentId,
        int256 predictionValue,
        uint256 confidence,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(swarmId, agentId, predictionValue, confidence, salt));
    }

    /**
     * @notice Commit a prediction and lock the prediction bond.
     * Stake does NOT increase decision influence; reputation determines influence.
     */
    function commitPrediction(
        uint256 swarmId,
        bytes32 agentId,
        bytes32 commitmentHash
    ) external payable onlyAgentOwner(agentId) nonReentrant {
        Swarm storage swarm = swarms[swarmId];
        require(
            swarm.state == SwarmState.AgentsSelected,
            "SwarmMindCore: not in commit state"
        );
        require(block.timestamp <= swarm.commitDeadline, "SwarmMindCore: commit deadline passed");
        require(isAgentSelectedInSwarm[swarmId][agentId], "SwarmMindCore: agent not selected for swarm");
        require(!swarmPredictions[swarmId][agentId].committed, "SwarmMindCore: already committed");
        require(msg.value >= swarm.minBond, "SwarmMindCore: insufficient prediction bond");

        swarmPredictions[swarmId][agentId] = PredictionCommitment({
            commitmentHash: commitmentHash,
            bondAmount: msg.value,
            committed: true,
            revealed: false,
            predictionValue: 0,
            confidence: 0,
            committedAt: block.timestamp,
            revealedAt: 0
        });

        swarm.totalBonded += msg.value;

        emit AgentCommitted(swarmId, agentId, commitmentHash, msg.value);

        // Check if all selected agents have committed
        if (_allSelectedAgentsCommitted(swarmId)) {
            swarm.state = SwarmState.Revealing;
        }
    }

    /**
     * @notice Transition to reveal phase if commit deadline has passed or all committed.
     */
    function transitionToRevealPhase(uint256 swarmId) external {
        Swarm storage swarm = swarms[swarmId];
        require(swarm.state == SwarmState.AgentsSelected, "SwarmMindCore: invalid state");
        require(
            block.timestamp > swarm.commitDeadline || _allSelectedAgentsCommitted(swarmId),
            "SwarmMindCore: commit phase still active"
        );
        swarm.state = SwarmState.Revealing;
    }

    /**
     * @notice Reveal previously committed prediction with salt.
     * The contract cryptographically verifies the reveal against the commitment hash.
     */
    function revealPrediction(
        uint256 swarmId,
        bytes32 agentId,
        int256 predictionValue,
        uint256 confidence,
        bytes32 salt
    ) external onlyAgentOwner(agentId) {
        Swarm storage swarm = swarms[swarmId];
        require(swarm.state == SwarmState.Revealing, "SwarmMindCore: not in reveal state");
        require(block.timestamp <= swarm.revealDeadline, "SwarmMindCore: reveal deadline passed");

        PredictionCommitment storage commitment = swarmPredictions[swarmId][agentId];
        require(commitment.committed, "SwarmMindCore: no commitment found");
        require(!commitment.revealed, "SwarmMindCore: already revealed");

        bytes32 expectedHash = computeCommitmentHash(
            swarmId,
            agentId,
            predictionValue,
            confidence,
            salt
        );
        require(expectedHash == commitment.commitmentHash, "SwarmMindCore: invalid reveal verification");

        commitment.revealed = true;
        commitment.predictionValue = predictionValue;
        commitment.confidence = confidence;
        commitment.revealedAt = block.timestamp;

        emit AgentRevealed(swarmId, agentId, predictionValue, confidence);
    }

    function _allSelectedAgentsCommitted(uint256 swarmId) internal view returns (bool) {
        Swarm storage swarm = swarms[swarmId];
        if (swarm.selectedAgents.length == 0) return false;
        for (uint256 i = 0; i < swarm.selectedAgents.length; i++) {
            if (!swarmPredictions[swarmId][swarm.selectedAgents[i]].committed) {
                return false;
            }
        }
        return true;
    }

    // =============================================================
    //                 PHASE 4: CHALLENGE MARKET
    // =============================================================

    /**
     * @notice Challenge a target agent's revealed prediction.
     * Prevents spam by requiring challenge bond and limiting concurrent challenges.
     */
    function challengePrediction(
        uint256 swarmId,
        bytes32 targetAgentId,
        string calldata evidenceHash
    ) external payable nonReentrant returns (uint256 challengeId) {
        Swarm storage swarm = swarms[swarmId];
        require(swarm.state == SwarmState.Revealing, "SwarmMindCore: not in challengeable state");
        require(
            swarmPredictions[swarmId][targetAgentId].revealed,
            "SwarmMindCore: target has not revealed"
        );
        require(
            agents[targetAgentId].owner != msg.sender,
            "SwarmMindCore: cannot challenge own agent"
        );
        require(msg.value >= swarm.minChallengeBond, "SwarmMindCore: insufficient challenge bond");
        require(
            predictionChallengeCount[swarmId][targetAgentId] < 3,
            "SwarmMindCore: challenge limit reached for prediction"
        );

        challengeId = nextChallengeId++;

        challenges[challengeId] = Challenge({
            challengeId: challengeId,
            swarmId: swarmId,
            targetAgentId: targetAgentId,
            challenger: msg.sender,
            challengeBond: msg.value,
            evidenceHash: evidenceHash,
            status: ChallengeStatus.Pending,
            createdAt: block.timestamp
        });

        swarmChallengeIds[swarmId].push(challengeId);
        predictionChallengeCount[swarmId][targetAgentId]++;

        emit ChallengeCreated(
            challengeId,
            swarmId,
            targetAgentId,
            msg.sender,
            msg.value,
            evidenceHash
        );
    }

    // =============================================================
    //              PHASE 5: OUTCOME RESOLUTION
    // =============================================================

    /**
     * @notice Resolve swarm using the attached IOutcomeResolver contract.
     */
    function resolveSwarm(uint256 swarmId) external {
        Swarm storage swarm = swarms[swarmId];
        require(
            swarm.state == SwarmState.Revealing,
            "SwarmMindCore: invalid state for resolution"
        );
        require(swarm.outcomeResolver != address(0), "SwarmMindCore: no resolver contract configured");

        (bool resolved, int256 outcomeValue, bytes memory evidence) =
            IOutcomeResolver(swarm.outcomeResolver).getOutcome(swarmId);
        require(resolved, "SwarmMindCore: outcome not resolved yet by resolver");

        swarm.finalOutcome = outcomeValue;
        swarm.resolutionEvidence = evidence;
        swarm.state = SwarmState.Resolved;

        emit SwarmResolved(swarmId, outcomeValue, evidence);
    }

    /**
     * @notice Fallback direct resolution by swarm creator or owner if no external resolver contract.
     */
    function resolveSwarmDirect(
        uint256 swarmId,
        int256 outcomeValue,
        bytes calldata evidence
    ) external {
        Swarm storage swarm = swarms[swarmId];
        require(
            swarm.state == SwarmState.Revealing,
            "SwarmMindCore: invalid state for resolution"
        );
        require(
            msg.sender == swarm.creator || msg.sender == owner(),
            "SwarmMindCore: unauthorized resolver"
        );

        swarm.finalOutcome = outcomeValue;
        swarm.resolutionEvidence = evidence;
        swarm.state = SwarmState.Resolved;

        emit SwarmResolved(swarmId, outcomeValue, evidence);
    }

    // =============================================================
    //         PHASE 6 & 7: SETTLEMENT & REPUTATION LEDGER
    // =============================================================

    struct SettlementState {
        uint256 totalSlashedBonds;
        uint256 correctAgentCount;
        uint256 totalWeight;
        uint256 distributedChallengeBonus;
        uint256 totalDistributedRewards;
    }

    /**
     * @notice Settle the swarm: distribute rewards, slash incorrect agents,
     * resolve challenges, and update domain-specific reputation.
     */
    function settleSwarm(uint256 swarmId) external nonReentrant {
        Swarm storage swarm = swarms[swarmId];
        require(swarm.state == SwarmState.Resolved, "SwarmMindCore: swarm not resolved");

        SettlementState memory ss;
        bytes32[] memory correctAgents = new bytes32[](swarm.selectedAgents.length);
        uint256[] memory agentWeights = new uint256[](swarm.selectedAgents.length);

        // 1. Process agent predictions & bonds
        _processAgentSettlement(swarmId, ss, correctAgents, agentWeights);

        // 2. Process Challenges
        _processChallengeSettlement(swarmId, ss);

        // 3. Distribute Rewards to Correct Agents
        _distributeRewards(swarmId, ss, correctAgents, agentWeights);

        swarm.state = SwarmState.Settled;
        emit SwarmSettled(swarmId, ss.totalDistributedRewards, ss.totalSlashedBonds);
    }

    function _processAgentSettlement(
        uint256 swarmId,
        SettlementState memory ss,
        bytes32[] memory correctAgents,
        uint256[] memory agentWeights
    ) internal {
        Swarm storage swarm = swarms[swarmId];
        for (uint256 i = 0; i < swarm.selectedAgents.length; i++) {
            bytes32 aId = swarm.selectedAgents[i];
            PredictionCommitment storage pc = swarmPredictions[swarmId][aId];
            Agent memory ag = agents[aId];

            agentTotalPredictions[aId]++;

            if (pc.revealed && pc.predictionValue == swarm.finalOutcome) {
                correctAgents[ss.correctAgentCount] = aId;
                uint256 currentRep = agentDomainReputation[aId][swarm.requiredCapability];
                uint256 weight = currentRep + BASE_REPUTATION_WEIGHT;
                agentWeights[ss.correctAgentCount] = weight;
                ss.totalWeight += weight;
                ss.correctAgentCount++;
                agentCorrectPredictions[aId]++;

                if (pc.bondAmount > 0) {
                    payable(ag.owner).sendValue(pc.bondAmount);
                }

                _updateDomainReputation(
                    aId,
                    swarm.requiredCapability,
                    int256(REPUTATION_SUCCESS_BOOST)
                );
            } else {
                if (pc.bondAmount > 0) {
                    ss.totalSlashedBonds += pc.bondAmount;
                    emit BondSlashed(swarmId, aId, pc.bondAmount);
                }

                int256 penalty = pc.revealed
                    ? -int256(REPUTATION_FAILURE_PENALTY)
                    : -int256(REPUTATION_NO_REVEAL_PENALTY);
                _updateDomainReputation(aId, swarm.requiredCapability, penalty);

                emit PredictionSettled(swarmId, aId, false, 0, 0);
            }
        }
    }

    function _processChallengeSettlement(
        uint256 swarmId,
        SettlementState memory ss
    ) internal {
        Swarm storage swarm = swarms[swarmId];
        uint256[] memory cIds = swarmChallengeIds[swarmId];
        uint256 challengeBonusPool = ss.totalSlashedBonds / 2;

        for (uint256 c = 0; c < cIds.length; c++) {
            Challenge storage ch = challenges[cIds[c]];
            if (ch.status == ChallengeStatus.Pending) {
                PredictionCommitment memory targetPc = swarmPredictions[swarmId][ch.targetAgentId];
                bool targetWasCorrect = targetPc.revealed && targetPc.predictionValue == swarm.finalOutcome;

                if (!targetWasCorrect) {
                    ch.status = ChallengeStatus.Upheld;
                    uint256 bonus = (challengeBonusPool > 0 && cIds.length > 0)
                        ? challengeBonusPool / cIds.length
                        : 0;
                    ss.distributedChallengeBonus += bonus;

                    uint256 totalPayout = ch.challengeBond + bonus;
                    payable(ch.challenger).sendValue(totalPayout);

                    emit ChallengeResolved(
                        ch.challengeId,
                        swarmId,
                        ChallengeStatus.Upheld,
                        ch.challenger,
                        totalPayout
                    );
                } else {
                    ch.status = ChallengeStatus.Dismissed;
                    ss.totalSlashedBonds += ch.challengeBond;

                    emit ChallengeResolved(
                        ch.challengeId,
                        swarmId,
                        ChallengeStatus.Dismissed,
                        ch.challenger,
                        0
                    );
                }
            }
        }
    }

    function _distributeRewards(
        uint256 swarmId,
        SettlementState memory ss,
        bytes32[] memory correctAgents,
        uint256[] memory agentWeights
    ) internal {
        Swarm storage swarm = swarms[swarmId];
        uint256 remainingSlashed = ss.totalSlashedBonds > ss.distributedChallengeBonus
            ? ss.totalSlashedBonds - ss.distributedChallengeBonus
            : 0;
        uint256 totalDistributableReward = swarm.bounty + remainingSlashed;

        if (ss.correctAgentCount > 0 && ss.totalWeight > 0) {
            for (uint256 k = 0; k < ss.correctAgentCount; k++) {
                bytes32 aId = correctAgents[k];
                address agentOwner = agents[aId].owner;
                uint256 rewardShare = (totalDistributableReward * agentWeights[k]) / ss.totalWeight;

                if (rewardShare > 0) {
                    ss.totalDistributedRewards += rewardShare;
                    payable(agentOwner).sendValue(rewardShare);
                    emit RewardPaid(swarmId, agentOwner, rewardShare);
                }

                emit PredictionSettled(
                    swarmId,
                    aId,
                    true,
                    rewardShare,
                    swarmPredictions[swarmId][aId].bondAmount
                );
            }
        } else {
            payable(swarm.creator).sendValue(swarm.bounty);
            emit RewardPaid(swarmId, swarm.creator, swarm.bounty);
        }
    }

    /**
     * @notice Internal helper to update domain reputation clamped within [0, MAX_REPUTATION].
     */
    function _updateDomainReputation(
        bytes32 agentId,
        string memory capability,
        int256 delta
    ) internal {
        uint256 oldRep = agentDomainReputation[agentId][capability];
        uint256 newRep;

        if (delta >= 0) {
            newRep = oldRep + uint256(delta);
            if (newRep > MAX_REPUTATION) {
                newRep = MAX_REPUTATION;
            }
        } else {
            uint256 penalty = uint256(-delta);
            if (penalty >= oldRep) {
                newRep = 0;
            } else {
                newRep = oldRep - penalty;
            }
        }

        agentDomainReputation[agentId][capability] = newRep;
        emit ReputationUpdated(agentId, capability, oldRep, newRep);
    }

    // =============================================================
    //                     VIEW HELPERS
    // =============================================================

    function getAgentReputation(
        bytes32 agentId,
        string calldata capability
    ) external view returns (uint256) {
        return agentDomainReputation[agentId][capability];
    }

    function getSwarm(uint256 swarmId) external view returns (Swarm memory) {
        return swarms[swarmId];
    }

    function getSwarmSelectedAgents(uint256 swarmId) external view returns (bytes32[] memory) {
        return swarms[swarmId].selectedAgents;
    }

    function getPrediction(
        uint256 swarmId,
        bytes32 agentId
    ) external view returns (PredictionCommitment memory) {
        return swarmPredictions[swarmId][agentId];
    }

    function getSwarmChallenges(uint256 swarmId) external view returns (uint256[] memory) {
        return swarmChallengeIds[swarmId];
    }

    function getChallenge(uint256 challengeId) external view returns (Challenge memory) {
        return challenges[challengeId];
    }
}
