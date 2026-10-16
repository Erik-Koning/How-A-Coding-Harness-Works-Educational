# End-to-end agentic run

Type: task
Status: open
Blocked by: 17

## Question

Does the whole thing work? This is the destination ticket — resolving it resolves the map.

## Definition of done

`opencode run "<a real, non-trivial task>"` completes, with **no AI API key present on the machine**,
where the task genuinely requires a multi-step tool loop — read a file, edit it, run a command,
check the result. Not a single-tool toy.

And, per the destination's reliability bar, the run must survive **at least one recoverable failure**
without a human touching it. Force them deliberately rather than waiting for luck:

- Close the Copilot tab mid-run → the Shim must Re-seed from the Transcript of Record and continue.
- Induce a malformed reply → the Repair Loop must recover it.

Record what actually happened: how many Turns, wall-clock per Turn, how many repairs and re-seeds
fired, and every place a human had to intervene.

## What this ticket is likely to expose

Expect this to surface real tickets rather than simply pass. The things most likely to break first,
and which should be graduated into their own tickets rather than patched in place here:

- Latency compounding — a 20-Turn task at 15s a Turn is five minutes of staring.
- Context growth — the Transcript outgrowing the input ceiling mid-run.
- Copilot drifting out of protocol as the conversation lengthens.
- opencode's own compaction firing and colliding with our divergence detection.
