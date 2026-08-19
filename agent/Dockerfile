# The agent underwriters, packaged to run somewhere that stays awake.
#
# These hold their own keys and escrow their own capital, so "it runs on my
# laptop" is not a deployment - a sleeping agent is an underwriter who stopped
# answering the market mid-commitment. Nothing here is stateful; the chain is
# the state, and a restart resumes from whatever the book says.

FROM oven/bun:1-alpine

WORKDIR /app

# Dependencies first, so a code change does not re-resolve the tree.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

# Run unprivileged. The image carries no keys - they arrive as environment at
# run time, and an agent key is a spending key.
USER bun

ENV INTERVAL_MS=20000

CMD ["bun", "run", "src/index.ts"]
