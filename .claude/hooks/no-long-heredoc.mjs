// PreToolUse guard (retro S01, S02a, S04b, S05, S07): a long script pasted into a shell heredoc — or
// into an inline `node -e "…"` — breaks on Windows Git Bash (quotes, `$$`, curly quotes, backticks).
// Refuse heredocs over MAX_LINES and inline node scripts over MAX_INLINE_LINES, and say what to do
// instead: write the script with the Write tool to a file (the scratchpad for throwaway ones) and run
// it from there. Short ones (a commit message, a three-line snippet) pass.
const MAX_LINES = 15;
const MAX_INLINE_LINES = 3;

const deny = (what) =>
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${what}. Write the script with the Write tool to a file (scratchpad for throwaway ones) and run that file — root CLAUDE.md → Rules → Scripts.`,
      },
    }),
  );

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input)?.tool_input?.command ?? '';
  } catch {
    process.exit(0);
  }
  // An inline `node -e "…"` over a few lines breaks the same way: Bash runs its backticks and `$(…)`
  // inside the double quotes (retro S07).
  const inline = /\bnode\s+(?:-e|--eval|-p|--print)\s/.exec(command);
  if (inline && command.slice(inline.index).split('\n').length > MAX_INLINE_LINES) {
    deny(`An inline node script over ${MAX_INLINE_LINES} lines`);
    return;
  }
  // `sed -i` with a backslash in it: Git Bash quoting dropped the backslashes of a regex three times in
  // one slice (retro S09c) — `/ \(…\)$/` became `/ (…)$/`. Edit or a Write'd Node script keeps them.
  const sed = /(?:^|[;&|(\s])sed\s+(?:-[A-Za-z]*\s+)*-[A-Za-z]*i/.exec(command);
  if (sed && command.slice(sed.index).includes('\\')) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            "`sed -i` with a backslash: the shell can drop it (retro S09c). Use the Edit tool, or a Write'd Node script with split(a).join(b) — root CLAUDE.md → Rules → Scripts.",
        },
      }),
    );
    return;
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
      deny(`A ${lines}-line heredoc (limit ${MAX_LINES})`);
      return;
    }
  }
});
