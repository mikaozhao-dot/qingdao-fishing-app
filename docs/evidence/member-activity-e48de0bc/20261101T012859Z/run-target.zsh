#!/bin/zsh
emulate -LR zsh
setopt nounset

runner_main() {
  if (( $# < 3 )); then print -u2 'runner: bad-arguments'; return 64; fi
  local id=$1
  shift
  if [[ $1 != -- ]]; then print -u2 'runner: missing-separator'; return 64; fi
  shift
  if [[ ! $id =~ '^[a-z0-9][a-z0-9-]*$' ]]; then print -u2 'runner: bad-id'; return 64; fi
  if [[ -z ${RUN_EVIDENCE_DIR-} || ! -d $RUN_EVIDENCE_DIR ]]; then print -u2 'runner: evidence-dir-unavailable'; return 73; fi
  local base="$RUN_EVIDENCE_DIR/$id"
  if [[ -e $base ]]; then print -u2 'runner: duplicate-id'; return 73; fi
  mkdir -m 700 "$base" || return 73
  local started=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  local cwd=$(pwd -P)
  local program='source "$RUN_EVIDENCE_DIR/capture-command.zsh"; capture_main "$@"'
  {
    print -r -- "cwd=$cwd"
    if [[ -n ${GIT_DIR-} ]]; then print -r -- 'inherited_environment=GIT_DIR (value omitted by privacy boundary)'; fi
    print -r -- 'argv-shell-escaped:'
    printf '%q ' zsh -c "$program" zsh "$id" -- "$@"
    print
  } > "$base/capture-wrapper-command.txt" || return 74
  local rc
  if zsh -c "$program" zsh "$id" -- "$@" > "$base/capture-wrapper-stdout.bin" 2> "$base/capture-wrapper-stderr.bin"; then rc=0; else rc=$?; fi
  local ended=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  printf '{"started_utc":"%s","ended_utc":"%s","exit_code":%d}\n' "$started" "$ended" "$rc" > "$base/capture-wrapper-result.json" || return 74
  return "$rc"
}
