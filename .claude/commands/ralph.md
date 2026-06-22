---
description: "Ralph loop with a default completion-promise + max-iterations (both overridable)"
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT]"
allowed-tools: ["Bash"]
---

Starting a Ralph loop with my defaults baked in. Pass your own `--max-iterations`
or `--completion-promise` after the prompt to override either one.

```!
SETUP=$(ls -t ~/.claude/plugins/cache/claude-plugins-official/ralph-loop/*/scripts/setup-ralph-loop.sh 2>/dev/null | head -1)
if [ -z "$SETUP" ]; then
  echo "❌ ralph-loop plugin not found — run: claude plugin install ralph-loop@claude-plugins-official"
  exit 1
fi
"$SETUP" --completion-promise "I am 100% certain this task is fully complete and verified" --max-iterations 25 $ARGUMENTS
```

Now work on the task above. The Ralph stop hook will feed the SAME PROMPT back to
you each time you try to finish — you'll see your prior work in the files and git
history, so iterate and improve.

To END the loop, output exactly `<promise>I am 100% certain this task is fully
complete and verified</promise>` — but ONLY when that statement is genuinely and
verifiably true (run the tests / checks first). Do not emit it to escape the loop,
even if you feel stuck. The `--max-iterations` cap is the backstop; `/cancel-ralph`
is the manual kill switch.
