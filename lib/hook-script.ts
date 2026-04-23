export const POST_CHECKOUT_SCRIPT = `#!/bin/sh
# Clocktopus post-checkout hook — auto-installed by \`clocktopus hook:install\`
# Fires only on branch checkout (flag "1"), not on file checkout.

if [ "$3" != "1" ]; then
  exit 0
fi

# Require an attached tty; otherwise the prompt has nowhere to render.
if ! [ -t 0 ] || ! [ -t 1 ]; then
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

clocktopus hook:prompt "$branch" </dev/tty >/dev/tty 2>&1 || true
exit 0
`;
