import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

const messageTypeTsPath = join(repoRoot, 'shared-protocol', 'MessageType.ts');
const extensionDestPath = join(repoRoot, 'chrome-extension', 'content', 'protocol-types.js');

try {
  console.log(`Reading protocol definitions from ${messageTypeTsPath}...`);
  const tsContent = readFileSync(messageTypeTsPath, 'utf8');

  // Simple regex to parse TypeScript enum fields
  // e.g., CREATE_SESSION = 'CREATE_SESSION',
  const enumRegex = /(\w+)\s*=\s*['"]([^'"]+)['"]/g;
  const entries = [];
  let match;
  while ((match = enumRegex.exec(tsContent)) !== null) {
    entries.push(`  ${match[1]}: '${match[2]}'`);
  }

  if (entries.length === 0) {
    throw new Error('No enum entries found in MessageType.ts. Check parsing regex.');
  }

  const jsContent = `// Auto-generated from shared-protocol/MessageType.ts - DO NOT EDIT MANUALLY
const MessageType = {
${entries.join(',\n')}
};

// Export for Node/CommonJS environments (e.g. tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MessageType };
}

// Bind to global scope based on environment
if (typeof window !== 'undefined') {
  window.MessageType = MessageType;
} else if (typeof globalThis !== 'undefined') {
  globalThis.MessageType = MessageType;
} else if (typeof self !== 'undefined') {
  self.MessageType = MessageType;
}
`;

  console.log(`Writing generated JavaScript types to ${extensionDestPath}...`);
  writeFileSync(extensionDestPath, jsContent, 'utf8');
  console.log('Protocol generation completed successfully.');
} catch (error) {
  console.error('Failed to generate protocol types:', error);
  process.exit(1);
}
