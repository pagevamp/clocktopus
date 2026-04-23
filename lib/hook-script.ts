export const POST_CHECKOUT_SCRIPT = `#!/bin/sh
# Clocktopus post-checkout hook — auto-installed by \`clocktopus hook:install\`
# Fires only on branch checkout (flag "1"), not on file checkout.

if [ "$3" != "1" ]; then
  exit 0
fi

# Require a tty on stdout; otherwise the prompt has nowhere to render.
# Git commonly redirects hook stdin, so we only check stdout here.
if ! [ -t 1 ]; then
  exit 0
fi

# Respect user opt-out.
if [ "$CLOCKTOPUS_HOOK_DISABLE" = "1" ]; then
  exit 0
fi

branch=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0
[ -z "$branch" ] && exit 0

# Resolve clocktopus binary; silently skip if not installed globally.
if ! command -v clocktopus >/dev/null 2>&1; then
  exit 0
fi

# Bun has a tty WriteStream bug on macOS when invoked from git hooks.
# Prefer node when available; fall back to bun/clocktopus.
bin=$(command -v clocktopus)
resolved="$bin"
link=$(readlink "$bin" 2>/dev/null || true)
if [ -n "$link" ]; then
  case "$link" in
    /*) resolved="$link" ;;
    *) resolved="$(cd "$(dirname "$bin")" && cd "$(dirname "$link")" && pwd)/$(basename "$link")" ;;
  esac
fi

if command -v node >/dev/null 2>&1; then
  NO_COLOR=1 FORCE_COLOR=0 node "$resolved" hook:prompt "$branch" </dev/tty || true
else
  NO_COLOR=1 FORCE_COLOR=0 clocktopus hook:prompt "$branch" </dev/tty || true
fi
exit 0
`;
