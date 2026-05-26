# ADR 0003: Bun workspaces

Bun for workspace install and root scripts. Keep tsc for builds and Vitest for tests during initial migration to avoid Bun runtime API lock-in inside publishable packages.
