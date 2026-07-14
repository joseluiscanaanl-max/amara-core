# AMARA CORE

Repositorio oficial de la plataforma AMARA.

## Requisitos

- Node.js 24
- pnpm 11
- Docker Desktop
- Git

## InstalaciÃ³n

```powershell
Copy-Item .env.example .env
pnpm.cmd install
docker compose up -d postgres redis
pnpm.cmd dev
```

## Servicios

- Portal del Hogar: http://localhost:3000
- API: http://localhost:3001/v1/health
- Panel administrativo: http://localhost:3002
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## VerificaciÃ³n

```powershell
pnpm.cmd typecheck
pnpm.cmd build
```