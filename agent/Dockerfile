# The agent underwriters, packaged for a reproducible run.
#
# There is no daemon here. The agents grade and price on demand and stop; a
# person approves before anything reaches the chain. So this image is a tool,
# not a service - `propose` writes an audit record, `execute --yes` acts on one.
#
# The image carries no keys. They arrive as environment at run time, and an
# agent key is a spending key.

FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

USER bun

CMD ["bun", "run", "src/propose.ts"]
