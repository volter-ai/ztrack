# Retired workflows

These files are historical source, not active workflows or current policy.

The owner rule of 2026-10-14 makes `main` an autonomous integration branch that
never publishes. Publication is a separately authorized action through `publish`.
The old workflow published every push to main and allowed a sixty-minute job;
it is retired by card t_d6817635. No active workflow is retained: a per-job
limit would not establish the required sixty-second end-to-end bound.

Merging source does not publish ztrack 3.0.0. Its publication and downstream
package-lock updates remain the release owner's separately authorized work.
