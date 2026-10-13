# FanaticOSOS — traspaso técnico completo para el siguiente agente

**Fecha del corte:** 13 de octubre de 2026, America/Chicago  
**Objetivo:** permitir que otro agente continúe el mantenimiento y la reparación sin depender del historial de esta conversación.  
**Prioridad inmediata del propietario:** publicar artículos, audios y canción semanal sin SSH, comandos manuales, ciclos de interfaz ni reparaciones posteriores.

## 1. Estado ejecutivo

FanaticOSOS es un sitio estático bilingüe construido con Astro, publicado en Cloudflare Pages, con un publicador privado alojado en el servidor `papabear`. El publicador administra borradores, traducción, TTS, imágenes, vista previa, releases inmutables y despliegues validados. El Game Center se actualiza por automatización en Papabear. Las funciones dinámicas de Participa, administración de invitados y mapa corren como Cloudflare Pages Functions.

En producción, al momento de este traspaso:

- Sitio principal: <https://fanaticosos.com/>
- Alias `www`: <https://www.fanaticosos.com/>
- Proyecto Pages: `fanaticosos-web`
- Artículo español publicado y verificado HTTP 200:
  <https://fanaticosos.com/blog/bears-7-packers-31-cinco-entregas-y-un-descalabro-en-lambeau-field/>
- Artículo inglés publicado y verificado HTTP 200:
  <https://fanaticosos.com/en/blog/bears-7-packers-31-five-turnovers-and-a-collapse-at-lambeau-field/>
- Canción semanal visible en la portada: **Fool's Gold — Buffalo Traffic Jam**.
- Último despliegue validado del artículo: `https://15a70615.fanaticosos-web.pages.dev`.
- Job del artículo: `release-83f66eda9a4748d38a2d13035bc02ffa-r2-6b8aacca`.
- Draft del artículo: `83f66eda-9a47-48d3-8a2d-13035bc02ffa`, revisión 2.
- Job de la canción: `release-098b51e6f47346d18440da2fcb91bd11-r1-17bd066f`.
- Despliegue de la canción: `https://3d56b324.fanaticosos-web.pages.dev`.

El artículo y la canción sí quedaron publicados. Sin embargo, el sistema no debe considerarse estable todavía: los reintentos se repararon durante el incidente, pero falta demostrar varias publicaciones semanales consecutivas sin intervención.

## 2. Repositorio y GitHub

- Repositorio: <https://github.com/fanaticosos/fanaticosos-web>
- Remote usado en macOS:
  `git@github-fanaticosos:fanaticosos/fanaticosos-web.git`
- Rama pública principal: `main`
- Rama histórica que también se mantiene actualizada: `feature/multilingual-audio-blog`
- Ambas ramas apuntaban al commit `e8fd7f5` al terminar el incidente.
- Últimos commits relevantes:

```text
e8fd7f5 Restart stale production upload safely
ab5e844 Recover interrupted production upload markers
6da9b05 Make production publication retries reliable
3c1791e Replace stale deployment queue entries on retry
c2c88aa Clear stale deployment failures before retry
edabd27 Retry failed production deployments
699b048 Allow production audio validation to finish
3e264ec Rebuild articles when the production base changes
77446ca Allow retrying failed weekly song publications
81370d3 Restore publication without Git synchronization
14c498c [CI Skip] Recover published weekly song
```

Configuración SSH de GitHub indicada por el propietario:

```sshconfig
Host github-fanaticosos
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_fanaticosos
    IdentitiesOnly yes
```

La passphrase está guardada en Apple Keychain. No copiarla a archivos, mensajes, el repositorio ni Papabear.

### Regla crítica de Git

Papabear usa un deploy key **de solo lectura**. Puede hacer `fetch`, pero no `push`. Un cambio anterior intentó convertir el despliegue en publicación + push automático desde Papabear. Eso rompió el flujo porque el servidor no tiene una credencial de escritura. El commit `81370d3` volvió a separar ambas responsabilidades.

La publicación pública **no debe depender de que Papabear empuje GitHub**. Los cambios de software se hacen desde una estación autorizada, se empujan a GitHub y luego Papabear sincroniza con `fanaticosos-blog-admin sync`. El contenido se publica como release validado directamente a Cloudflare Pages.

## 3. Copias locales y forma segura de trabajar

Workspace principal conocido:

```text
/Users/acontreras/Documents/Fanaticosos Blog
```

Durante el incidente se utilizó un worktree limpio:

```text
/Users/acontreras/.codex/worktrees/game-center-recovery/Fanaticosos Blog
```

El workspace principal puede contener cambios del propietario. Antes de editar:

```bash
git status --short
git remote -v
git log -1 --oneline
```

No descartar cambios ajenos. Preferir un worktree limpio si el principal está sucio. No usar `git reset --hard` ni `git checkout --` sobre cambios del propietario.

## 4. Tecnologías y herramientas

- Astro `7.1.4`, salida estática.
- Node.js `>=24 <25`; Papabear usa Node `v24.18.0` bajo `/opt/nodejs/current`.
- npm `11.16.0` en la línea base documentada.
- Cloudflare Pages + Pages Functions.
- Wrangler `4.118.0` fijado en `package.json`.
- SQLite como autoridad del workflow del publicador.
- systemd para workers, límites, cola y automatizaciones.
- Qwen3 8B local mediante llama.cpp para traducción.
- TTS de producción encapsulado por `scripts/tts/render_article_production.py`; la unidad carga credenciales Azure y ElevenLabs si están instaladas.
- FFmpeg/ffprobe para medios y audiogramas.
- NetBird para acceso privado al publicador.
- Navidrome para la canción semanal.
- GitHub para código fuente.
- Cloudflare KV/Pages Functions para funciones dinámicas según bindings configurados en Pages.

Comandos de proyecto importantes:

```bash
npm ci
npm run build
npm run test:publisher
npm run test:game-center-update
npm run test:participation-backend
npm run test:participation-slots
npm run test:access-auth
```

No existe un script genérico `npm test`; usar los scripts explícitos de `package.json`.

## 5. Arquitectura del sitio público

Configuración Astro: `astro.config.mjs`  
Páginas principales:

```text
src/pages/index.astro                         portada y Game Center
src/pages/blog/index.astro                    índice del blog ES
src/pages/blog/[slug].astro                  artículo ES
src/pages/en/blog/index.astro                 índice del blog EN
src/pages/en/blog/[slug].astro               artículo EN
src/pages/participa.astro                     reserva pública de invitados
src/pages/admin/invitados.astro               administración de invitados
src/pages/mapa.astro                          mapa ES
src/pages/en/map.astro                        mapa EN
src/pages/pages/contact.astro                 contacto ES
src/pages/en/pages/contact.astro              contacto EN
```

Funciones dinámicas de Cloudflare:

```text
functions/api/participa.js
functions/api/participa/config.js
functions/api/participa/slots.js
functions/api/admin/invitados.js
functions/api/admin/invitados/action.js
functions/api/admin/invitados/reserve.js
functions/api/fan-map.js
functions/lib/access.js
functions/lib/participation.js
```

Datos versionados importantes:

```text
src/data/game-center.json
src/data/participation-slots.json
src/data/site-settings.json
src/content/articles/es/*.md
src/content/articles/en/*.md
public/audio/
public/images/articles/
public/assets/nfl-logos/
```

El build completo valida contenido, settings, Game Center, logos, slots, Functions, tipos de Astro y salida final.

## 6. Papabear

- Host: `papabear`
- SO documentado: Ubuntu 24.04.4 LTS, amd64.
- NetBird/IP privado: `100.121.48.92`
- Usuario administrativo: `sysadmin`
- Servicio de aplicación: `fanaticosos-blog` sin login interactivo y sin sudo.
- Acceso habitual desde la Mac: `ssh papabear`.
- Publicador privado: <http://100.121.48.92:4310/>
- El publicador solo debe ser accesible por NetBird/red permitida.

Árbol del servidor:

```text
/opt/fanaticosos-blog/
├── repository/                  checkout Git de solo lectura respecto a GitHub
├── publisher/
│   ├── database/publisher.sqlite
│   ├── queue/
│   ├── releases/
│   ├── artifacts/
│   ├── uploads/
│   ├── notifications/
│   ├── backups/database/
│   └── game-center/
├── jobs/                        trabajos de traducción/TTS/video
├── models/                      modelos locales
├── runtimes/                    entornos Python
├── tools/                       llama.cpp y otras herramientas fijadas
└── cache/
```

Helper root restringido:

```text
/usr/local/sbin/fanaticosos-blog-admin
```

Su definición versionada está en:

```text
deploy/admin/fanaticosos-blog-admin
deploy/admin/fanaticosos-blog-admin.sudoers
```

No ejecutar Git como root. Sincronización correcta del servidor:

```bash
ssh papabear 'sudo -n /usr/local/sbin/fanaticosos-blog-admin sync EXPECTED_FULL_COMMIT'
```

Después de cambiar el helper o los servicios del publicador:

```bash
ssh papabear 'sudo -n /usr/local/sbin/fanaticosos-blog-admin update-admin EXPECTED_FULL_COMMIT'
ssh papabear 'sudo -n /usr/local/sbin/fanaticosos-blog-admin install-publisher EXPECTED_FULL_COMMIT'
```

No pedir al propietario que pegue bloques de shell salvo que sea absolutamente inevitable. El helper restringido existe precisamente para que un agente autorizado pueda diagnosticar y reparar sin improvisar comandos root.

## 7. Servicios systemd

Archivos versionados en `deploy/systemd/`:

- `fanaticosos-publisher.service`: interfaz privada Node en `100.121.48.92:4310`.
- `fanaticosos-publisher-dispatcher.path`: observa `publisher/queue/.wake`.
- `fanaticosos-publisher-dispatcher.service`: reclama y lanza jobs.
- `fanaticosos-translation@.service`: traducción local Qwen, límite 60 min/16 GB.
- `fanaticosos-tts@.service`: TTS, límite 15 min/8 GB.
- `fanaticosos-audiogram@.service`: video completo.
- `fanaticosos-release@.service`: build privado del artículo.
- `fanaticosos-music-release@.service`: build aislado de canción.
- `fanaticosos-music-deploy@.service`: publicación de canción.
- `fanaticosos-production-deploy@.service`: despliegue validado a producción.
- `fanaticosos-game-center-update.service` y `.timer`: consulta programada.
- `fanaticosos-game-center-publish.service`: publica propuesta validada.
- `fanaticosos-release-retention.service` y `.timer`: retención diaria.

Diagnóstico seguro:

```bash
ssh papabear 'sudo -n /usr/local/sbin/fanaticosos-blog-admin publisher-status'
ssh papabear 'sudo -n /usr/local/sbin/fanaticosos-blog-admin game-center-automation-status'
ssh papabear 'systemctl --no-pager --full status fanaticosos-publisher.service'
ssh papabear 'journalctl --no-pager -u UNIT --since "YYYY-MM-DD HH:MM:SS"'
```

## 8. Flujo del publicador

Código de interfaz y API:

```text
publisher/server.mjs
publisher/public/index.html
publisher/public/app.js
publisher/public/styles.css
publisher/lib/*.mjs
publisher/migrations/*.sql
publisher/test/*.test.mjs
```

Flujo esperado:

1. Crear/abrir borrador y guardar español.
2. Crear traducción inglesa.
3. Revisar/corregir inglés y ambos guiones de narración.
4. Guardar.
5. Generar o regenerar únicamente el audio afectado.
6. Escuchar ambos audios.
7. Preparar vista previa privada.
8. Validar vista previa.
9. Publicar el release exacto.
10. Validar portada, rutas ES/EN, MP3, dominios y rollback.

SQLite es la autoridad. El filesystem contiene artefactos grandes y releases inmutables. La existencia de un archivo no debe ser interpretada por la UI como finalización si SQLite no registra el estado correspondiente.

Documentación base:

- `docs/FANATICOSOS_V2_ARCHITECTURE_CONTRACT.md`
- `docs/PUBLICATION_RUNBOOK.md`
- `docs/CONTENT_MODEL.md`
- `docs/TRANSLATION_JOB_CONTRACT.md`
- `docs/TTS_JOB_CONTRACT.md`
- `docs/RECOVERY_BACKUP_RUNBOOK.md`

## 9. Credenciales y secretos

Nunca incluir los valores en Git ni en el traspaso. Ubicaciones conocidas en Papabear:

```text
/etc/fanaticosos-blog/cloudflare-pages.env
/etc/fanaticosos-blog/azure-speech.env
/etc/fanaticosos-blog/elevenlabs.env
```

El token de Cloudflare debe permitir el despliegue requerido al proyecto `fanaticosos-web`. La cuenta validada por el script tiene ID:

```text
500cc7e82e34b5837b06a22ffee9f162
```

El deploy key GitHub de Papabear es intencionalmente de solo lectura. Las credenciales de escritura viven en la estación autorizada, no en el servidor.

## 10. Cloudflare y despliegues

Script principal:

```text
scripts/deployment/deploy_cloudflare_production.sh
```

Propiedades:

- usa Wrangler fijado en el repositorio;
- serializa despliegues con `/run/lock/fanaticosos-cloudflare-production.lock`;
- valida el manifest inmutable antes de subir;
- valida `fanaticosos.com`, `www.fanaticosos.com` y `fanaticosos-web.pages.dev`;
- verifica HTML y checksums exactos de MP3;
- conserva el despliegue anterior para rollback;
- si la convergencia falla, restaura el despliegue previo;
- la descarga de MP3 usa actualmente `curl --max-time 180` porque un MP3 de ~12.5 MB excedió el límite anterior de 30 segundos.

Despliegue manual de recuperación de un release ya validado:

```bash
ssh papabear 'sudo -n /usr/local/sbin/fanaticosos-blog-admin deploy-cloudflare-production EXPECTED_COMMIT RELEASE_JOB_ID'
```

Este comando no sustituye el flujo normal; solo es recuperación.

## 11. Game Center

Fuente versionada actual:

```text
src/data/game-center.json
scripts/update-game-center.mjs
scripts/publisher/run_game_center_automation.mjs
scripts/publisher/build_game_center_release.mjs
deploy/publisher/fanaticosos-game-center-automation
deploy/publisher/fanaticosos-game-center-publish
```

Frecuencia acordada con el propietario:

- Fuera de la ventana de partido: consulta aproximadamente cada 24 horas.
- Desde 30 minutos antes del inicio hasta 8 horas después: consulta aproximadamente cada 10 minutos.
- El timer despierta cada 10 minutos, pero el runner decide si realmente toca consultar.

Datos esperados:

- próximo partido;
- porcentajes de ganar de Bears y rival, usando ESPN Analytics para el matchup;
- último partido;
- últimos cuatro resultados;
- posiciones NFC Norte;
- Predicciones 2026: `% de playoffs`, `% de ganar división`, `Promedio de victorias`;
- actualización automática solo cuando el contenido cambia;
- release reconstruido desde el release actualmente seleccionado para no borrar artículos, canción o medios recientes.

La automatización fue una fuente anterior de regresiones visuales y de contenido. Toda modificación debe probar que preserva el release base completo. Véase `docs/GAME_CENTER_PUBLICATION.md`.

## 12. Participa y administración de invitados

Páginas:

- Pública: <https://fanaticosos.com/participa/>
- Administración: <https://fanaticosos.com/admin/invitados/>

Código:

```text
src/pages/participa.astro
src/pages/admin/invitados.astro
functions/api/participa*.js
functions/api/admin/invitados*.js
functions/lib/participation.js
src/data/participation-slots.json
docs/M5_PARTICIPA_CLOUDFLARE_RUNBOOK.md
```

Requisitos expresados por el propietario:

- nunca ofrecer fechas pasadas;
- administración con navegación directa y menos clics;
- ver fechas disponibles y solicitudes sin paneles anidados confusos;
- poder reservar desde administración con solo nombre y email;
- enlace claro para regresar a Participa;
- confirmación de reserva consistente y, si está implementado, correo verificable al invitado.

El siguiente agente debe revisar bindings y datos reales de producción antes de afirmar que los correos se envían.

## 13. Qué falló durante el último incidente

### 13.1 Publicación acoplada erróneamente a Git

Se agregó sincronización automática del contenido publicado hacia GitHub desde Papabear. El servidor solo posee un deploy key read-only. El push falló con:

```text
ERROR: The key you are authenticating with has been marked as read only.
```

El commit `81370d3` quitó esa dependencia del despliegue. No reintroducirla sin diseñar explícitamente una credencial de escritura de mínimo privilegio y sin separar claramente “publicar” de “respaldar en Git”. La recomendación actual es no darle escritura a Papabear.

### 13.2 Rebase manual dejó el checkout en estado intermedio

Los intentos de recuperación produjeron `rebase-merge`, cambios staged y errores por identidad Git. Esto no debe volver a resolverse dando al propietario bloques improvisados. Usar exclusivamente el helper `sync EXPECTED_COMMIT`, que hace fetch y fast-forward limpio.

### 13.3 Canción guardada pero no publicada

El job guardó la canción, pero falló la publicación del paquete completo. Se corrigió la capacidad de reintentar jobs de música fallidos (`77446ca`). La canción finalmente se publicó.

### 13.4 Artículo atrapado en preparación/vista previa/publicación

Hubo ciclos de estado entre guardar, vista previa y publicar. También hubo una traducción detenida durante demasiado tiempo. Se hicieron correcciones previas de reconciliación idempotente y de reconstrucción cuando el release base cambia, pero falta una prueba end-to-end repetida.

### 13.5 Validación de audio demasiado corta

La descarga pública del MP3 español (~12.5 MB) agotó `curl --max-time 30`. El despliegue hizo rollback correctamente, pero el artículo no quedó publicado. Se aumentó a 180 segundos en `699b048`.

### 13.6 Reintento registrado pero nunca despachado

Después del rollback quedaron:

- `production-request.json` del intento reclamado;
- estado de systemd fallido;
- marcadores `.cloudflare-production.log.*` de intentos interrumpidos.

La API creó un nuevo estado `running`, pero el dispatcher omitió el directorio porque ya existía `production-request.json`. Los commits `edabd27`, `c2c88aa`, `3c1791e` y `6da9b05` limpian evidencia obsoleta, reemplazan la cola y permiten reclamar un reintento. Los commits `ab5e844` y `e8fd7f5` archivan marcadores interrumpidos y vuelven a subir el mismo bundle inmutable.

### 13.7 Semántica engañosa de canción `stale`

Después de publicar el artículo, `/api/music` mostró el job de la canción como `stale`, aunque la portada pública sí mostraba correctamente `Fool's Gold`. Esto parece significar “ese release ya no es el release activo” y no “la canción desapareció”. La UI/API debería separar:

- settings de canción actualmente activos;
- job histórico que los publicó;
- release actualmente activo que incorpora esos settings.

No mostrar “stale” como fallo si los settings activos coinciden con producción.

## 14. Reparación que todavía falta

No asumir que una publicación exitosa demuestra que todo está resuelto. Trabajo pendiente prioritario:

1. Añadir una prueba end-to-end automatizada que cree un draft de prueba, traduzca o inyecte traducción controlada, genere/inserte ambos audios, prepare preview, publique, valide dominios y luego retire el contenido de prueba.
2. Añadir pruebas específicas de retry con:
   - `production-request.json` preexistente;
   - unit systemd en estado failed;
   - `production-failure.json` antiguo;
   - uno y varios `.cloudflare-production.log.*`;
   - rollback ya completado;
   - timeout durante descarga de MP3.
3. Corregir el modelo/estado de publicación de música para que no aparezca `stale` cuando la canción activa está incluida en un release posterior.
4. Hacer que el dispatcher registre explícitamente por qué omite una entrada de cola. Actualmente puede terminar con exit 0 aunque haya saltado el deploy.
5. Hacer que la UI muestre el paso exacto y una acción de recuperación segura, no solo “en ejecución” o un botón que vuelve al mismo ciclo.
6. Probar reinicios del publicador y del servidor durante traducción, TTS, build, upload y verificación.
7. Ejecutar al menos varias publicaciones consecutivas de artículo + canción, sin intervención SSH, antes de declarar estable el flujo.
8. Verificar que un despliegue de Game Center conserva exactamente artículos, canción, audios, imágenes y rutas del release base.
9. Revisar que el contenido publicado quede respaldado de forma coherente en Git sin bloquear el deploy. Si se desea respaldo automático, diseñarlo como job posterior independiente y tolerante a fallos, ejecutado donde sí exista credencial de escritura.

## 15. Pruebas mínimas antes de cualquier despliegue de software

```bash
npm ci
npm run test:publisher
npm run test:game-center-update
npm run test:participation-backend
npm run test:participation-slots
npm run build
git diff --check
```

Para cambios pequeños se pueden ejecutar pruebas dirigidas con `node --test`, pero antes de cerrar una reparación del publicador debe correrse `npm run test:publisher` completo.

Después de publicar:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://fanaticosos.com/
curl -fsS -o /dev/null -w '%{http_code}\n' ARTICLE_ES_URL
curl -fsS -o /dev/null -w '%{http_code}\n' ARTICLE_EN_URL
```

Además verificar en contenido real:

- título ES y EN;
- imagen;
- ambos reproductores y MP3 completos;
- canción semanal y artista;
- Game Center;
- `/blog/` y `/en/blog/`;
- despliegue recibido como `completed` por la API privada.

## 16. Procedimiento recomendado para el próximo agente

1. Leer completamente este documento y los contratos en `docs/`.
2. Verificar `git status`, ramas, remotes y commit de `main`.
3. Comprobar el sitio público sin cambiar nada.
4. Comprobar el publicador y timer de Game Center con comandos read-only.
5. Respaldar SQLite con el helper antes de migraciones o cambios de estado.
6. Reproducir cada defecto con una prueba, no directamente sobre el artículo semanal.
7. Implementar cambios pequeños y separados.
8. Ejecutar pruebas completas y build.
9. Empujar desde la estación autorizada.
10. Sincronizar Papabear mediante el helper, nunca mediante Git como root.
11. Instalar únicamente los componentes modificados.
12. Publicar mediante la UI normal; usar recuperación manual solo si la prueba evidencia un defecto.
13. Verificar producción y rollback.
14. Documentar exactamente qué cambió y qué sigue pendiente.

## 17. Criterio real de terminación

El sistema solo estará reparado cuando el propietario pueda, cada semana y sin ayuda técnica:

- corregir español y guion TTS;
- guardar una sola vez de forma predecible;
- traducir y revisar;
- generar únicamente el audio que cambió;
- abrir y validar preview;
- publicar artículo ES/EN;
- cambiar y publicar la canción semanal;
- recibir mensajes claros si un proveedor externo falla;
- reintentar desde la misma interfaz sin SSH;
- conservar Game Center, blog, música, Participa y demás contenido en cada despliegue.

Una sola ejecución exitosa no satisface este criterio.
