# M5 — Activación de Participa en Cloudflare

Este documento describe la activación remota. No contiene credenciales y no convierte una computadora personal en infraestructura de producción.

## Objective

Activar el formulario de `/participa`, la base D1, los correos transaccionales y el panel protegido `/admin/invitados` en el proyecto Cloudflare Pages `fanaticosos-web`.

## Cloudflare Pages bindings

Configurar los mismos bindings en Preview y Production:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| D1 database | `DB` | `fanaticosos-participa` (`6bbd7721-7b4e-4280-ba01-3ef35ca82d53`) |
| Secret | `BREVO_API_KEY` | API key de Brevo |
| Secret | `TURNSTILE_SECRET_KEY` | secret key del widget FanaticOSOS |
| Variable | `PUBLIC_TURNSTILE_SITE_KEY` | site key del widget FanaticOSOS |
| Variable | `BREVO_FROM_EMAIL` | `stream@fanaticosos.com` |
| Variable | `PARTICIPATION_ADMIN_EMAIL` | `stream@fanaticosos.com` |
| Variable | `ACCESS_TEAM_DOMAIN` | dominio del equipo de Cloudflare Access, sin ruta |
| Variable | `ACCESS_AUD` | Application Audience (AUD) de la aplicación Access |

La identidad `stream@fanaticosos.com` debe estar validada como remitente o pertenecer a un dominio autenticado en Brevo.

## D1 migration

Desde un checkout limpio de la versión aprobada, autenticar Wrangler con una identidad autorizada y ejecutar:

```sh
npx wrangler d1 migrations apply fanaticosos-participa --remote
```

La migración `migrations/0001_participation.sql` crea dos tablas, sus índices de integridad y las 16 fechas de la temporada. Antes de desplegar, comprobar que D1 reporta 16 filas:

```sh
npx wrangler d1 execute fanaticosos-participa --remote \
  --command "SELECT COUNT(*) AS slots FROM participation_slots"
```

## Cloudflare Access

Crear una aplicación Access de tipo Self-hosted para:

```text
www.fanaticosos.com/admin/invitados*
fanaticosos.com/admin/invitados*
fanaticosos-web.pages.dev/admin/invitados*
```

La política debe permitir únicamente `stream@fanaticosos.com`. Copiar el Team domain y el Application Audience (AUD) a las variables anteriores. El backend vuelve a verificar firma, emisor, audiencia, vigencia y email; la regla perimetral no es la única defensa.

## Verification

1. Ejecutar `npm run build` antes de desplegar.
2. Desplegar primero a Preview con el flujo existente del proyecto.
3. En Preview, enviar una solicitud de prueba y confirmar que:
   - Turnstile valida el envío;
   - se crea una fila pendiente;
   - participante y administrador reciben correo;
   - una segunda solicitud para la misma fecha queda en lista de espera.
4. Abrir `/admin/invitados`, confirmar la primera solicitud y comprobar que la fecha deja de aceptar solicitudes.
5. Rechazar una solicitud en otra fecha y comprobar la promoción de la primera persona en espera.
6. Revisar que el panel no sea accesible sin sesión de Access.
7. Sólo después de estas pruebas, solicitar aprobación para Production.

## Stop / rollback

- No aplicar la migración ni cambiar bindings de Production sin aprobación explícita.
- Si Preview falla, retirar ese despliegue; no borrar la base D1.
- La migración inicial no tiene rollback destructivo automático. Conservar los datos y corregir hacia adelante.
- Rotar inmediatamente cualquier clave que se publique accidentalmente en terminal, Git, logs o capturas.
