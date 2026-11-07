# Message blockers are external wait relations

Accepted 2026-09-30 for board-ir c63 (`t_3c06efd1`, `t_911a730d`).

A task's bare `m-…` or `a-…` blocker names a message, not an acceptance criterion
inside its parent card. Resolve valid message identifiers as external references.
The blocker referent rule does not require a card node for them; readiness already
retains them as message waits. Card and task blockers still require real nodes,
and message identifiers do not make valid `blocks` targets.

The kanban preset's `waiting-on` field remains the single-message shorthand.
Additional message waits can appear in `blocked-by` without inventing nodes or
discarding relations. Sibling task references use their actual parent card and
task key. A product writing this preset must translate its runtime identifiers to
the document's identifiers before serializing those references.
