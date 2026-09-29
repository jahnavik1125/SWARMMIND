// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IOutcomeResolver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MVPControlledResolver
 * @notice Controlled outcome resolver implementation for SwarmMind MVP.
 * Clearly designated as an MVP controlled resolver for deterministic, falsifiable benchmarks.
 */
contract MVPControlledResolver is IOutcomeResolver, Ownable {
    struct OutcomeRecord {
        bool resolved;
        int256 outcomeValue;
        bytes evidence;
        uint256 resolvedAt;
        address resolvedBy;
    }

    // swarmId => OutcomeRecord
    mapping(uint256 => OutcomeRecord) private _outcomes;

    // Authorized oracles/resolvers
    mapping(address => bool) public authorizedResolvers;

    event OutcomeSet(
        uint256 indexed swarmId,
        int256 outcomeValue,
        bytes evidence,
        address indexed resolver
    );

    event ResolverAuthorizationChanged(address indexed resolver, bool authorized);

    modifier onlyAuthorized() {
        require(msg.sender == owner() || authorizedResolvers[msg.sender], "MVPControlledResolver: unauthorized");
        _;
    }

    constructor() Ownable(msg.sender) {
        authorizedResolvers[msg.sender] = true;
    }

    function setAuthorizedResolver(address resolver, bool authorized) external onlyOwner {
        authorizedResolvers[resolver] = authorized;
        emit ResolverAuthorizationChanged(resolver, authorized);
    }

    /**
     * @notice Set deterministic outcome for a swarm based on verified measurable real-world data.
     */
    function setOutcome(
        uint256 swarmId,
        int256 outcomeValue,
        bytes calldata evidence
    ) external onlyAuthorized {
        require(!_outcomes[swarmId].resolved, "MVPControlledResolver: outcome already set");
        _outcomes[swarmId] = OutcomeRecord({
            resolved: true,
            outcomeValue: outcomeValue,
            evidence: evidence,
            resolvedAt: block.timestamp,
            resolvedBy: msg.sender
        });

        emit OutcomeSet(swarmId, outcomeValue, evidence, msg.sender);
    }

    function isResolved(uint256 swarmId) external view override returns (bool) {
        return _outcomes[swarmId].resolved;
    }

    function getOutcome(uint256 swarmId) external view override returns (
        bool resolved,
        int256 outcomeValue,
        bytes memory evidence
    ) {
        OutcomeRecord memory rec = _outcomes[swarmId];
        return (rec.resolved, rec.outcomeValue, rec.evidence);
    }
}
