#!/bin/sh
# Refuses commits on the default branch and pushes to it, for people and agents alike.
# Called by .husky/pre-commit ("commit") and .husky/pre-push ("push", ref lines on stdin).
# Plain sh on purpose: it must work in GUI clients that have git but no node or npm.
#
# The release workflow commits and pushes to main with semantic-release, and husky
# installs these hooks there too (npm ci runs `prepare`), so GitHub Actions is exempt.
# This is a speed bump, not the enforcement: the "Protect default branch" ruleset is.

set -u

mode="${1:-}"

if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    exit 0
fi

default="main"
if origin_head=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null); then
    default="${origin_head#origin/}"
fi

refuse() {
    echo "branch-guard: $1" >&2
    echo "branch-guard: work on a branch and open a pull request: git switch -c <your-name>/<topic>" >&2
    exit 1
}

case "$mode" in
commit)
    branch=$(git symbolic-ref -q --short HEAD 2>/dev/null) || exit 0
    if [ "$branch" = "$default" ]; then
        refuse "commits on '$default' are not allowed."
    fi
    ;;
push)
    # Each line: <local ref> <local sha> <remote ref> <remote sha>
    while read -r _local_ref _local_sha remote_ref _remote_sha; do
        if [ "$remote_ref" = "refs/heads/$default" ]; then
            refuse "pushes to '$default' are not allowed."
        fi
    done
    ;;
*)
    echo "branch-guard: unknown mode '$mode' (expected 'commit' or 'push'), so nothing was checked" >&2
    ;;
esac

exit 0
