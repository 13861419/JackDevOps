FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/server/package.json apps/server/package.json
RUN corepack enable && pnpm install --frozen-lockfile
RUN cd apps/server && ./node_modules/.bin/tsc -p tsconfig.build.json --traceResolution 2>&1 | grep -B2 -A10 "Resolving module 'drizzle-orm/node-postgres'" | head -30 || echo "no trace output"
RUN pnpm --version && node --version
COPY apps/server apps/server
RUN pnpm --filter @jackdevops/server build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/server/node_modules ./node_modules
COPY --from=build /repo/apps/server/package.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
