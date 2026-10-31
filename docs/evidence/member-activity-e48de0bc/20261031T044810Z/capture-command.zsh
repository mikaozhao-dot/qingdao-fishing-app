#!/bin/zsh
emulate -L zsh
setopt NO_UNSET PIPE_FAIL

# One invocation captures exactly one target command. No shell-evaluated command strings.
if (( $# < 3 )); then
  print -u2 -- 'usage: capture-command.zsh <id> -- <executable> [args...]'
  exit 64
fi
command_id="$1"
shift
if [[ "$1" != -- ]]; then
  print -u2 -- 'missing -- separator'
  exit 64
fi
shift
if (( $# < 1 )); then
  print -u2 -- 'missing target executable'
  exit 64
fi

: "${QF_CAPTURE_ROOT:?QF_CAPTURE_ROOT must be a run-specific /tmp path}"
: "${QF_COMMAND_CWD:?QF_COMMAND_CWD must be a run-specific /tmp path}"
if [[ "$QF_CAPTURE_ROOT" != /tmp/qf-e48de0bc.*/capture ]]; then
  print -u2 -- 'capture root outside approved /tmp namespace'
  exit 65
fi
if [[ "$QF_COMMAND_CWD" != repo-root && "$QF_COMMAND_CWD" != /tmp/qf-e48de0bc.* ]]; then
  print -u2 -- 'command cwd outside approved /tmp namespace'
  exit 65
fi
if [[ -z "$command_id" || "${command_id//[A-Za-z0-9_-]/}" != '' ]]; then
  print -u2 -- 'invalid command id'
  exit 64
fi

command_dir="$QF_CAPTURE_ROOT/$command_id"
mkdir -m 700 "$command_dir" || exit 70
stdout_file="$command_dir/stdout.bin"
stderr_file="$command_dir/stderr.bin"
result_file="$command_dir/result.json"
wrapper_stdout="$command_dir/capture-wrapper-stdout.bin"
wrapper_stderr="$command_dir/capture-wrapper-stderr.bin"
wrapper_result="$command_dir/capture-wrapper-result.json"
wrapper_command="$command_dir/capture-wrapper-command.txt"

# Capture the capture-wrapper's own streams separately. Target streams below are
# redirected directly to their own files and are never copied to the terminal.
exec >"$wrapper_stdout" 2>"$wrapper_stderr"
wrapper_start="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" || exit 71
target_start="$wrapper_start"
target_argv=("$@")
{
  print -r -- "wrapper=$0"
  print -r -- 'wrapper_cwd=repo-root'
  print -r -- "command_id=$command_id"
  print -r -- "target_cwd=$QF_COMMAND_CWD"
  print -r -- 'target_argv:'
  printf '  %q\n' "${target_argv[@]}"
} >"$wrapper_command" || exit 72
{
  print -r -- "cwd=$QF_COMMAND_CWD"
  print -r -- 'argv:'
  printf '  %q\n' "${target_argv[@]}"
} >"$command_dir/command.txt" || exit 72

target_rc=0
if [[ "$QF_COMMAND_CWD" == repo-root ]]; then
  if ( "$@" ) >"$stdout_file" 2>"$stderr_file"; then
    target_rc=0
  else
    target_rc=$?
  fi
elif ( cd "$QF_COMMAND_CWD" && "$@" ) >"$stdout_file" 2>"$stderr_file"; then
  target_rc=0
else
  target_rc=$?
fi
target_end="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" || exit 73

printf '{"exit_code":%d,"signal":null,"start_utc":"%s","end_utc":"%s"}\n' \
  "$target_rc" "$target_start" "$target_end" >"$result_file" || exit 74
wrapper_end="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" || exit 73
printf '{"exit_code":%d,"start_utc":"%s","end_utc":"%s"}\n' \
  "$target_rc" "$wrapper_start" "$wrapper_end" >"$wrapper_result" || exit 74
exit "$target_rc"
