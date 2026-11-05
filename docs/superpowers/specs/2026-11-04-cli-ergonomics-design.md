# CLI ergonomics

The approved approach combines Optique command composition with Bun-inspired terminal output. The supplied `bun --help` screenshot is the visual reference: compact introductory text, aligned command/argument/description columns, blank lines between command groups, colored command names and cyan flags, and dim examples and version text. Avoid boxes, banners and animation.

All commands use one Optique grammar for argument validation and help. Keep existing names, options, business behavior, exit codes and machine-readable formats. Root `--help` and `-h` join `help`; command help lists actual options and retains examples and detailed agent guidance. Claude and Codex arguments, including help flags and separators, pass through unchanged. `loadouts help claude|codex` documents the wrappers.

Human output uses a small shared formatter: green successes/additions, yellow warnings/removals, red errors and muted details. Installation keeps useful change lines and adds a compact count; status displays selected sources and choices as readable rows rather than JSON. Doctor keeps actionable fixes. Raw JSON, exploration Markdown and child-process output stay untouched.

Color is automatic per output stream when attached to a terminal. A nonempty NO_COLOR or NODE_DISABLE_COLORS disables color; otherwise FORCE_COLOR=0 disables, any other nonempty FORCE_COLOR enables, and TTY detection supplies the default. Redirected output is plain by default. No extra color dependency is needed.

Tests use isolated homes and fixture tools. No real installations or project configuration are changed. Adding Optique is explicitly approved; other runtime dependencies are not needed. Native compilation must continue working. No new completion, interactive prompt, release, or publication functionality is included.
