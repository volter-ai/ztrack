# Pre-production Plan: Kill Questions, Risks, Gates

*Every experiment exists to answer a question that could kill the game.*

## Kill questions (ordered by lethality)

### KQ1 — Is a tiny model fun to talk to?
- **Kills**: the companion pillar, i.e., the game.
- **Test**: real chat sessions with a trained ~22M model.
- **Status**: 🟡 first signal GREEN. Needs full-length sessions on the finished
  model, multiple people.

### KQ2 — Does curriculum produce perceivably different personalities?
- **Kills**: the central mechanic (data = personality).
- **Test**: two corpora identical except personality parameters; blind A/B.
- **Status**: 🔴 untested, but now **push-button**: harness written.

### KQ3 — Does the 8GB min-spec actually work?
- **Kills**: the audience (median gamer), the business model.
- **Test**: retrain under an 8GB VRAM cap (enforced).
- **Status**: 🟢 **PASS (2026-07-02).** Peak VRAM 5.31GB → FITS.

### KQ4 — Is real-time training pacing fun or miserable?
- **Kills**: the core loop's minute-to-minute feel.
- **Test**: paper playtest, then a timed prototype session.
- **Status**: ⚫ some future-vocabulary marker nobody declared.

### Follow-up items

Plain prose under a hyphenated-word heading — never an issue (no digit in the
token), even in a registered emoji-register file.
