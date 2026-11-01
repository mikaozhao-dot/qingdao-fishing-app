#!/bin/zsh
emulate -LR zsh
setopt nounset

capture_main() {
  if (( $# < 3 )); then print -u2 'capture: bad-arguments'; return 64; fi
  local id=$1
  shift
  if [[ $1 != -- ]]; then print -u2 'capture: missing-separator'; return 64; fi
  shift
  if [[ ! $id =~ '^[a-z0-9][a-z0-9-]*$' ]]; then print -u2 'capture: bad-id'; return 64; fi
  if [[ -z ${RUN_EVIDENCE_DIR-} || ! -d $RUN_EVIDENCE_DIR ]]; then print -u2 'capture: evidence-dir-unavailable'; return 73; fi
  local base="$RUN_EVIDENCE_DIR/$id"
  local target="$base/target"
  if [[ -e $target ]]; then print -u2 'capture: duplicate-id'; return 73; fi
  mkdir -p -m 700 "$base" || return 73
  mkdir -m 700 "$target" || return 73
  local started=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  local cwd=$(pwd -P)
  {
    print -r -- "cwd=$cwd"
    print -r -- 'argv-shell-escaped:'
    printf '%q ' "$@"
    print
  } > "$target/command.txt" || return 74
  local rc
  if "$@" > "$target/stdout.bin" 2> "$target/stderr.bin"; then rc=0; else rc=$?; fi
  local ended=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  printf '{"started_utc":"%s","ended_utc":"%s","exit_code":%d}\n' "$started" "$ended" "$rc" > "$target/result.json" || return 74
  return "$rc"
}
