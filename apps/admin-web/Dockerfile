FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml ./
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN pnpm install --filter @amara/admin-web --frozen-lockfile=false
COPY apps/admin-web apps/admin-web
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @amara/admin-web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/apps/admin-web/.next/standalone ./
COPY --from=build /workspace/apps/admin-web/.next/static ./apps/admin-web/.next/static
EXPOSE 3002
CMD ["node", "apps/admin-web/server.js"]
