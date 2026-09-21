# Game Center: refresco y publicación automáticos

Estado desde 2026-09-21. La propuesta validada se publica automáticamente mediante el mismo despliegue protegido que usa el blog.

## Qué hace la automatización

`fanaticosos-game-center-update.timer` sigue ejecutando `/usr/local/sbin/fanaticosos-game-center-automation` cada 10 minutos. El runner:

1. Consulta las fuentes (ESPN y calendario oficial) cuando toca según la ventana de partido o el ciclo diario.
2. Si el marcador o el calendario cambiaron, construye un release privado completo a partir del release seleccionado (`releases/current`) y valida la página de inicio.
3. Deja el identificador del release en `/opt/fanaticosos-blog/publisher/game-center/deploy-ready` y crea la notificación `game-center-ready` en el publicador.
4. Si ya existe una propuesta validada con el mismo contenido, la reutiliza y no vuelve a construir.
5. El servicio de publicación separado publica el paquete completo, valida las rutas y audios públicos, y restaura el despliegue anterior si falla la validación.

Una propuesta construida antes de un artículo más reciente se considera obsoleta y se reconstruye desde el paquete actualmente seleccionado. Los despliegues se serializan para evitar que dos publicaciones se pisen.

## Publicación manual de recuperación

Desde Papabear, con el commit esperado del repositorio:

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin publish-game-center EXPECTED_COMMIT
```

Normalmente no hace falta ejecutarlo: el temporizador lo hace. Este comando queda para recuperación y comprueba que el repositorio esté limpio, que el paquete incluya el artículo actualmente seleccionado y que sea una propuesta validada de Game Center.

## Cómo ver si hay algo pendiente

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin game-center-automation-status
```

Muestra `pendingJobId` y `pendingSince` cuando hay una propuesta esperando.

## Forzar un refresco sin esperar al timer

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin run-game-center-update EXPECTED_COMMIT
```

Construye o reutiliza y publica la propuesta por la misma ruta protegida.

## Instalación

Después de sincronizar el repositorio al commit que contiene este cambio:

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin install-game-center-automation EXPECTED_COMMIT
sudo /usr/local/sbin/fanaticosos-blog-admin update-admin EXPECTED_COMMIT
```

El primer comando instala el runner nuevo; el segundo instala el helper con la protección frente a propuestas obsoletas. Sin ambos, el temporizador seguiría usando el comportamiento anterior.
