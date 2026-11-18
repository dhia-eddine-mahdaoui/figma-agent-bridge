# Figma Local Bridge

For installation requests, read `INSTALL.md` and run the supplied bootstrap for
the person's local client. Do not invent paths, run npm install, or reset an
existing checkout. Bootstrap installs the skill, MCP configuration, verified
runtime, and companion checks. Figma import and local pairing require user action.

For design work, read `skills/figma-local/SKILL.md` and `AGENTS.md`. Discover the
local MCP schemas; preserve editable native layers and inspect before writing.

For GitHub/release uploads, use `package-source.mjs`'s explicit allowlist. Do not
upload `.local`, `.bootstrap`, state, credentials, personal configs, extracted
Figma source, or local design captures. Never recursively upload this working folder.
