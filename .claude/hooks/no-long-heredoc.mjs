// PreToolUse guard (retro S01, S02a, S04b, S05): a long script pasted into a shell heredoc breaks on
// Windows Git Bash (quotes, `$$`, curly quotes). Refuse heredocs over MAX_LINES and say what to do
// instead: write the script with the Write tool to a file (the scratchpad for throwaway ones) and
// run it from there. Short heredocs (a commit message, a three-line snippet) pass.
const MAX_LINES = 15;

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input)?.tool_input?.command ?? '';
  } catch {
    process.exit(0);
  }
  // `<<EOF`, `<<'EOF'`, `<<"EOF"`, `<<-EOF` — then count lines until the closing delimiter.
  const re = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
  for (const match of command.matchAll(re)) {
    const delimiter = match[2];
    const rest = command
      .slice(match.index + match[0].length)
      .split('\n')
      .slice(1);
    const end = rest.findIndex((line) => line.trim() === delimiter);
    const lines = end === -1 ? rest.length : end;
    if (lines > MAX_LINES) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `A ${lines}-line heredoc (limit ${MAX_LINES}). Write the script with the Write tool to a file (scratchpad for throwaway ones) and run that file — root CLAUDE.md → Rules → Scripts.`,
          },
        }),
      );
      return;
    }
  }
});
