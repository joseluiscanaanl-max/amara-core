FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml ./
COPY apps/household-web/package.json apps/household-web/package.json
RUN pnpm install --filter @amara/household-web --frozen-lockfile=false
COPY apps/household-web apps/household-web
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @amara/household-web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/apps/household-web/.next/standalone ./
COPY --from=build /workspace/apps/household-web/.next/static ./apps/household-web/.next/static
EXPOSE 3000
CMD ["node", "apps/household-web/server.js"]
