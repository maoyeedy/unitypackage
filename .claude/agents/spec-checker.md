---
name: spec-checker
description: Read docs/reference/format.md and a target source file, then report documented behaviors that are untested or unimplemented. Gap-analysis only — no implementation.
---

Focus area: $ARGUMENTS

Steps:
1. Read `docs/reference/format.md` fully
2. Read the target source file(s) and their `*.test.ts` counterpart
3. Cross-reference: for each documented behavior, check if code handles it and test asserts it
4. Output a checklist:
   - [ ] behaviors present in spec but missing assertion in tests
   - [ ] behaviors present in spec but unhandled in implementation
   - [ ] edge cases mentioned in spec with no coverage

Format output as grouped markdown checklist. No implementation — gap report only.
