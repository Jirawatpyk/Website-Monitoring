#!/usr/bin/env node
// PostToolUse hook (Edit|Write): format the file Claude just wrote with the repo's Prettier config.
// Reads the hook JSON from stdin. Never blocks: any problem is ignored so editing keeps flowing.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const FORMATTABLE = /\.(ts|tsx|js|mjs|cjs|jsx|json|css|md|yml|yaml)$/i;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const input = JSON.parse(await readStdin());
  const filePath = input?.tool_response?.filePath ?? input?.tool_input?.file_path;
  if (typeof filePath === 'string' && FORMATTABLE.test(filePath)) {
    const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const prettier = createRequire(path.join(root, 'package.json'))('prettier');
    const ignorePath = path.join(root, '.prettierignore');
    const info = await prettier.getFileInfo(filePath, { ignorePath });
    if (!info.ignored && info.inferredParser) {
      const source = await readFile(filePath, 'utf8');
      const options = (await prettier.resolveConfig(filePath)) ?? {};
      const formatted = await prettier.format(source, { ...options, filepath: filePath });
      if (formatted !== source) await writeFile(filePath, formatted, 'utf8');
    }
  }
} catch {
  // Formatting is best-effort; lint and CI catch anything left.
}
