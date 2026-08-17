# Container image for @dropcheck/api. (apps/web deploys to Vercel and is
# excluded from this image entirely — see .dockerignore.)
#
#   docker build -t dropcheck-api .
#
# WHY THIS LIVES AT THE REPO ROOT rather than under apps/api:
#
#   1. The build context must include packages/shared and the root
#      package-lock.json, because this is an npm workspace. Hence
#      `dockerContext: .` in render.yaml.
#   2. Docker only reads .dockerignore from the context root, and that
#      file is what keeps apps/web and every node_modules out of the
#      upload — so both files belong at the same level.
#
# Single stage on purpose. A multi-stage build would normally shrink the
# image, but the bulk here is the ~300 MB native `claude` CLI binary that
# has to survive into the runtime layer anyway — so splitting stages buys
# nothing and adds a copy step that's easy to get wrong.

FROM node:22-slim

WORKDIR /app

# Manifests first so the dependency layer caches independently of source.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# NEVER add `--omit=optional` here. The Claude Agent SDK ships its native
# CLI as platform-specific *optional* dependencies
# (@anthropic-ai/claude-agent-sdk-linux-x64 and friends). Omitting them
# produces "Native CLI binary for linux-x64 not found" on the first chat
# request — a runtime 500, not a build failure, so it would ship silently.
RUN npm ci --workspace @dropcheck/api --include-workspace-root

# Source last: edits here don't invalidate the dependency layer.
COPY packages/shared packages/shared
COPY apps/api apps/api

# PORT is a fallback for plain `docker run`; Render injects its own at
# runtime, and runtime env beats image ENV.
ENV NODE_ENV=production \
    PORT=8080 \
    # The CLI subprocess writes session transcripts to disk, and needs a
    # writable HOME because the SDK derives other paths from it. Render's
    # filesystem is writable and ephemeral (reset on each deploy), so
    # /tmp is a correctness choice rather than a hard requirement — it
    # keeps transcripts out of the image layers and makes the container
    # behave the same on hosts that only allow writes there.
    CLAUDE_CONFIG_DIR=/tmp/.claude \
    HOME=/tmp

EXPOSE 8080

# Fail the BUILD if the native binary didn't install. Without this the
# failure surfaces as a 500 on the first user's first chat message, which
# is a far worse place to find out. node:22-slim is glibc/Debian, so
# linux-x64 is the right variant (not -musl).
RUN node -e "const p=require.resolve('@anthropic-ai/claude-agent-sdk-linux-x64/claude'); \
    const s=require('node:fs').statSync(p); \
    console.log('native CLI ok:', p, Math.round(s.size/1e6)+'MB');"

CMD ["npm", "run", "start", "-w", "@dropcheck/api"]
