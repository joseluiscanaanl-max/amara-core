# Estado de verificación

## Verificado dentro del entorno de construcción

- El ZIP previo fue inspeccionado y contiene código fuente real.
- Los archivos TypeScript y TSX pasan una verificación sintáctica con TypeScript 5.8.
- La secuencia de migraciones SQL es continua de `001` a `013`.
- Se añadieron configuraciones faltantes de Next.js y Dockerfiles.
- Se añadió un verificador reproducible mediante `pnpm verify`.

## Pendiente en una computadora con internet y Docker

1. Descargar dependencias con `pnpm install`.
2. Ejecutar `pnpm typecheck` y `pnpm build`.
3. Levantar PostgreSQL y Redis con Docker.
4. Ejecutar pruebas de integración contra las migraciones.
5. Corregir cualquier error de tipos, SQL o ejecución que aparezca.

No debe considerarse listo para producción hasta completar esos cinco puntos.
