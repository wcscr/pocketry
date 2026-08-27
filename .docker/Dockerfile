# Claude Code sandbox image for tooltrace (React + Express + TypeScript)
# Base: Node 22 on Debian bookworm — npm and toolchain preinstalled.
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# ---------- System packages ----------
# git, curl, ca-certs: version control and fetches
# tmux:                Claude Code session wrapper (see entrypoint)
#
# The remaining packages are Chromium's shared-library dependencies, needed so
# Playwright can drive a real browser for visual verification of the app. The
# list is Playwright's own for Debian bookworm (`npx playwright install
# chromium` prints it when they are missing). They must be installed here, as
# root: `playwright install --with-deps` shells out to apt-get and cannot work
# from the unprivileged `agent` user the container later switches to.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        tmux \
        libnspr4 \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libdbus-1-3 \
        libcups2 \
        libxkbcommon0 \
        libasound2 \
        libgbm1 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ---------- Working directory ----------
WORKDIR /workspace

# ---------------------------------------------------------------------------
# Non-root user — UID/GID must match the host so bind-mounted files are
# writable.  Pass --build-arg HOST_UID=<your uid> at build time;
# build_sandbox.sh does this automatically.  (The base image ships a `node`
# user at UID 1000; if the host UID collides with it, that user is renamed.)
# ---------------------------------------------------------------------------
ARG HOST_UID=1000
ARG HOST_GID=1001
RUN (groupadd -g ${HOST_GID} agent 2>/dev/null || groupadd agent 2>/dev/null || true) \
    && existing_user=$(getent passwd ${HOST_UID} | cut -d: -f1) \
    && if [ -n "$existing_user" ]; then \
         usermod -l agent -d /home/agent -m -g agent "$existing_user"; \
       else \
         useradd --uid ${HOST_UID} --gid agent --create-home agent; \
       fi \
    && mkdir -p /workspace/node_modules \
    && chown -R agent:agent /workspace

USER agent

# ---------- Claude Code CLI ----------
# Install via native installer (independent of the image's Node runtime).
# The installer places the binary under ~/.local/bin/.
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && ~/.local/bin/claude --version

ENV PATH="/home/agent/.local/bin:${PATH}"

ENV COLORTERM=truecolor

# Claude Code configuration.
RUN echo '{"hasCompletedOnboarding": true}' > ~/.claude.json \
    && mkdir -p /home/agent/.claude \
    && echo '{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"},"teammateMode":"tmux"}' > /home/agent/.claude/settings.json \
    && echo 'set -g default-terminal "screen-256color"' > /home/agent/.tmux.conf

# Trust /workspace for git — the bind-mount may be owned by a different UID
RUN git config --global --add safe.directory /workspace

# ---------- Chromium for visual verification ----------
# Baked into the image, as `agent`, so the download lands in that user's cache
# (~/.cache/ms-playwright). That path is container-local rather than a named
# volume, so downloading at run time instead would re-fetch ~150MB on every
# rebuild. No `--with-deps`: the shared libraries are already installed above,
# and apt-get is not available to this user.
#
# Playwright pins a browser build per release, so a driver newer than this
# image will fetch its own on first use and cache it for that container's
# lifetime. Baking one in just makes the common case fast.
RUN npx --yes playwright@1.62.1 install chromium

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
COPY --chmod=0755 .docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
