"""Shared recording lifecycle predicates for API and workers."""

ACTIVE_WORKFLOW_STATUSES = frozenset({"PROCESSING", "TRANSCRIBING", "ANALYZED"})
