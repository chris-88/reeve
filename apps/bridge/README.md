# @reeve/bridge

The worker that closes the loop the attention queue left manual: Go in the app → this process
claims the action → Claude Code runs the brief on the quinn machine → the result lands back in
*Needs you* with a push to the phone. Spec: `docs/arc-spec-bridge.md`.

Runs as the systemd user unit `reeve-bridge.service` (from `~/dotfiles`), which executes
`~/.local/bin/reeve-bridge` → `node apps/bridge/src/main.ts` in this repo. Node 24 strips the
types; there is no build step.

Secrets come from `pass` at start (`env/reeve/DATABASE_URL`, `infra/reeve/SERVICE_ROLE_KEY`);
`BRIDGE_DATABASE_URL`, `BRIDGE_SERVICE_ROLE_KEY` and `BRIDGE_FUNCTIONS_URL` override them for
tests. The permission envelope is `~/.claude/settings.json`, unchanged: a headless run cannot
ask, so anything outside the allowlist is denied.

```sh
systemctl --user status reeve-bridge      # is it up, last lines of the journal
systemctl --user stop reeve-bridge        # the pause switch; a run in flight finishes first
journalctl --user -u reeve-bridge -f      # live log
tail ~/backups/health/bridge.log          # one line per run
```
