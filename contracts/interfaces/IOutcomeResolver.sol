// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IOutcomeResolver
 * @notice Standard interface for SwarmMind outcome resolution.
 * Supports external oracles, optimistic assertions, dispute windows, and verified data feeds.
 */
interface IOutcomeResolver {
    /**
     * @notice Check if a specific swarm outcome is resolved.
     * @param swarmId The identifier of the swarm.
     */
    function isResolved(uint256 swarmId) external view returns (bool);

    /**
     * @notice Retrieve the deterministic outcome value and evidence reference.
     * @param swarmId The identifier of the swarm.
     * @return resolved Whether the outcome is ready and verified.
     * @return outcomeValue The integer outcome value (e.g., 1 for true/yes, 0 for false/no, or discrete metric).
     * @return evidence Raw bytes or URI/hash referencing the public measurable proof.
     */
    function getOutcome(uint256 swarmId) external view returns (
        bool resolved,
        int256 outcomeValue,
        bytes memory evidence
    );
}
