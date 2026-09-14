# Game Center: refresco automático, publicación manual

Estado desde 2026-09-14. Sustituye el comportamiento anterior en el que el timer desplegaba a producción por sí solo.

## Qué hace la automatización

`fanaticosos-game-center-update.timer` sigue ejecutando `/usr/local/sbin/fanaticosos-game-center-automation` cada 10 minutos. El runner:

1. Consulta las fuentes (ESPN y calendario oficial) cuando toca según la ventana de partido o el ciclo diario.
2. Si el marcador o el calendario cambiaron, construye un release privado completo a partir del release seleccionado (`releases/current`) y valida la página de inicio.
3. Deja el identificador del release en `/opt/fanaticosos-blog/publisher/game-center/deploy-ready` y crea la notificación `game-center-ready` en el publicador.
4. Si ya existe una propuesta validada con el mismo contenido, la reutiliza y no vuelve a construir.

El runner **no** sube nada a Cloudflare. Producción no cambia por acción del timer.

## Cómo publicar la propuesta

Desde Papabear, con el commit esperado del repositorio:

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin publish-game-center EXPECTED_COMMIT
```

El comando comprueba que el repositorio esté limpio y en el commit indicado, que exista `deploy-ready`, que el manifest sea de tipo `game-center` y `deployment: disabled`, y entonces ejecuta el mismo `deploy_cloudflare_production.sh` que usan los artículos: sube el bundle, valida los dominios públicos y hace rollback si algo falla. El resultado se registra con `record_game_center_deployment.mjs` y aparece como notificación `game-center-updated` o `game-center-update-failed`.

## Cómo ver si hay algo pendiente

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin game-center-automation-status
```

Muestra `pendingJobId` y `pendingSince` cuando hay una propuesta esperando.

## Forzar un refresco sin esperar al timer

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin run-game-center-update EXPECTED_COMMIT
```

Solo construye o reutiliza la propuesta; sigue sin publicar.

## Instalación

Después de sincronizar el repositorio al commit que contiene este cambio:

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin install-game-center-automation EXPECTED_COMMIT
sudo /usr/local/sbin/fanaticosos-blog-admin update-admin EXPECTED_COMMIT
```

El primer comando instala el runner nuevo; el segundo instala el helper con `publish-game-center`. Sin ambos, el timer seguiría usando el runner anterior.
