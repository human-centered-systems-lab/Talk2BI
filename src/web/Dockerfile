FROM oven/bun:1.3

WORKDIR /app

# bun.lock pins the exact dependency tree, so it is copied alongside
# package.json: without it the install resolves fresh versions and the image
# stops matching what was tested locally. Both are copied before the source so
# Docker can cache this layer across source-only changes.
COPY package.json bun.lock ./

# The full tree, including devDependencies — `next build` needs TypeScript and
# the @types packages, so this must not be a production-only install.
RUN bun install --frozen-lockfile

# Copy the rest of the app source
COPY . .

# Build the Next.js app
RUN bun run build

# Set after the build on purpose: exporting it earlier would make the install
# above skip devDependencies and the build would then fail.
ENV NODE_ENV=production

EXPOSE 3000

# Start the production server
CMD ["bun", "run", "start"]
