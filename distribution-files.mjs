// Explicit source distribution boundary. Never recursively publish the working directory.
export const DISTRIBUTION_FILES = [
  'package.json', 'LICENSE', 'README.md', 'SECURITY.md', 'USAGE.md', 'AGENTS.md', 'CLAUDE.md', '.gitignore', '.gitattributes',
  'INSTALL.md', 'bootstrap.ps1', 'bootstrap.sh', 'connect-ssh.ps1', 'Connect.cmd', 'desktop-bundle.mjs', 'ssh-info.mjs', 'node-checksums.json', '.gitlab-ci.yml',
  'install-agent.mjs', 'distribution-files.mjs', 'package-source.mjs', 'verify-package.mjs', 'run-tests.mjs',
  'paths.mjs', 'connection.mjs', 'runtime.mjs', 'pairing.mjs', 'server.mjs', 'client.mjs', 'assets.mjs', 'mcp.mjs',
  'contracts.mjs', 'call.mjs', 'doctor.mjs', 'setup.mjs', 'config.mjs',
  'verify-syntax.mjs', 'demo.mjs', 'demo-scene.json', 'install.cmd', 'start.cmd',
  'plugin/manifest.json', 'plugin/code.js', 'plugin/ui.html', 'plugin/logo.svg',
  'skills/figma-local/SKILL.md', 'skills/figma-local/agents/openai.yaml',
  'test/bridge.test.mjs', 'test/ui.test.mjs', 'test/pairing.test.mjs',
  'test/runtime.test.mjs', 'test/setup.test.mjs', 'test/rtl.test.mjs',
  'test/recovery.test.mjs', 'test/figma-fixture.mjs', 'test/install-agent.test.mjs', 'test/extraction.test.mjs', 'test/context-efficiency.test.mjs', 'test/connection.test.mjs',
  '.github/workflows/check.yml',
  'docs/figma-agent-bridge-demo.gif', 'docs/figma-agent-bridge-demo.mp4',
];
