FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --filter @amara/api... --frozen-lockfile=false
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @amara/api build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/node_modules ./node_modules
COPY --from=build /workspace/apps/api/package.json ./package.json
EXPOSE 3001
CMD ["node", "dist/main.js"]
