// Copyright (c) 2026 Clinical Outcomes Research Group, CORG LLC
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title AuditAnchor
/// @notice Tamper-evidence anchors for the Record Vault gateway audit log.
/// @dev The audit events themselves stay off-chain in the gateway's database.
///      Anchoring stores only a Merkle root over a contiguous range of events,
///      so later edits, insertions, or deletions inside an anchored range are
///      detectable by recomputing the root from the stored rows and comparing.
///      This contract is a companion to MedicalRecordsRegistry; it is not the
///      canonical registry and holds no consent state.
contract AuditAnchor {
    struct Anchor {
        bytes32 root;
        uint64 fromSeq;
        uint64 toSeq;
        uint64 anchoredAt;
        address anchorer;
    }

    Anchor[] private _anchors;

    event Anchored(uint256 indexed index, bytes32 root, uint64 fromSeq, uint64 toSeq, address anchorer);

    /// @notice Anchor a Merkle root over the audit-event sequence range [fromSeq, toSeq].
    function anchor(bytes32 root, uint64 fromSeq, uint64 toSeq) external returns (uint256 index) {
        require(root != bytes32(0), "empty root");
        require(toSeq >= fromSeq, "empty range");
        index = _anchors.length;
        _anchors.push(Anchor(root, fromSeq, toSeq, uint64(block.timestamp), msg.sender));
        emit Anchored(index, root, fromSeq, toSeq, msg.sender);
    }

    function anchorCount() external view returns (uint256) {
        return _anchors.length;
    }

    function getAnchor(uint256 index)
        external
        view
        returns (bytes32 root, uint64 fromSeq, uint64 toSeq, uint64 anchoredAt, address anchorer)
    {
        Anchor storage a = _anchors[index];
        return (a.root, a.fromSeq, a.toSeq, a.anchoredAt, a.anchorer);
    }
}
