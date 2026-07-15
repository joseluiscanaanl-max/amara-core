# Identity Module

Responsabilidades iniciales:

- Solicitud y verificaciÃ³n de OTP.
- Usuarios e identidades telefÃ³nicas.
- Sesiones y tokens.
- Roles y permisos.
- RecuperaciÃ³n de acceso.

## Endpoints iniciales

- `POST /auth/request-otp`
- `POST /auth/verify-otp`

## Estado

La primera versiÃ³n es un esqueleto compilable. AÃºn no contiene persistencia,
envÃ­o real de SMS, hashing de OTP, JWT ni rate limiting.