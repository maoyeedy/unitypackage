# ADR 0004: Extract overwrite policy

Default: error on collision. Lists all conflicting paths, exits non-zero. Opt-in flags:
- `--force`: overwrite all existing files
- `--skip-existing`: write only new files, skip existing
- `--merge`: skip byte-identical files, error on differing files
