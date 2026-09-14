# Fanaticosos: expediente para reauditoría independiente

Fecha de corte: 2026-09-14 (America/Chicago)  
Propósito: permitir que otra persona o agente audite el sistema sin depender de la memoria de esta conversación.  
Estado documental: mezcla de hechos verificados en Git, evidencia operativa copiada desde Papabear y asuntos todavía no verificados.  

> Este archivo no contiene contraseñas, claves privadas ni tokens. Indica dónde viven y quién debe poder leerlos. Copiar secretos a Git convertiría este expediente en una filtración.

## 1. Resumen ejecutivo

Fanaticosos es un sitio Astro bilingüe desplegado en Cloudflare Pages, con un publicador privado ejecutándose en un servidor Ubuntu llamado `papabear`. El publicador conserva borradores y artefactos en SQLite y en almacenamiento privado, ejecuta traducción local, genera audio mediante workers acotados, construye releases inmutables y puede subir previews o producción mediante comandos administrativos restringidos.

El sistema funciona, pero no está listo para considerarse plenamente recuperable ni estable en TTS. Los problemas principales al cierre son:

1. El audio español largo depende de ElevenLabs y del saldo/límite particular de su API key.
2. La generación incremental introdujo división, caché y ensamblaje con FFmpeg. La caché ya evita pagar nuevamente bloques idénticos, pero las fronteras o el ensamblaje pueden producir cortes audibles.
3. La prueba manual del mismo fragmento en ElevenLabs no produjo el corte de `5:19`; por tanto, el defecto está en el flujo propio, no en el texto ni necesariamente en la voz.
4. Se sugirió ElevenLabs Studio para delegar la producción completa al proveedor, pero **no está implementado** y su API puede requerir habilitación comercial. No debe tratarse como solución terminada.
5. Existe respaldo verificado de SQLite y un restore drill exitoso, pero no existe aún un procedimiento único, completo y probado para reconstruir toda la plataforma en otra VM.
6. La rama local principal del usuario está sucia y no debe limpiarse ni sobrescribirse. El trabajo reciente se realizó en un worktree aislado.

## 2. Fuentes y niveles de confianza

- **Verificado en Git:** inspeccionado directamente en la rama remota `feature/multilingual-audio-blog` hasta `b94d695`.
- **Verificado en Papabear:** salida de comandos ejecutados por `sysadmin` y pegada en esta conversación.
- **Observado en UI:** capturas o mensajes del publicador, previews y ElevenLabs.
- **No verificado:** inferencias o piezas para las que no se ejecutó una comprobación directa.

La reauditoría debe volver a comprobar el estado operativo; este archivo no sustituye una inspección fresca.

## 3. Repositorio y ramas

- Repositorio GitHub: `fanaticosos/fanaticosos-web`.
- Remoto local: `git@github-fanaticosos:fanaticosos/fanaticosos-web.git`.
- Rama de trabajo/desarrollo: `feature/multilingual-audio-blog`.
- Rama de producción de Cloudflare Pages: `main`.
- Último commit remoto al preparar este documento: `b94d695` (`Fix regenerated audio elapsed timer`).
- Worktree aislado usado para TTS: `/tmp/fanaticosos-tts-continuous.sDHlJ1`.
- Checkout principal del usuario: `/Users/acontreras/Documents/Fanaticosos Blog`.
- El checkout principal tenía modificaciones y archivos no rastreados del usuario; no deben borrarse, resetearse ni incorporarse mecánicamente.

### Historial funcional reciente

| Commit | Cambio |
|---|---|
| `e8d3fb9` | Validación de coordenadas del mapa antes de publicar |
| `264eae4` | Reposicionamiento del pin en Bears Nation |
| `4a380be` | Navegación compartida para páginas informativas |
| `b31eb00` | Navegación pública bilingüe unificada |
| `4e6ca51` | Presentación de contacto bilingüe unificada |
| `f7b8e0b` | Guiones de narración español/inglés independientes |
| `39cebb9` | Eliminación de Markdown en guiones de narración |
| `3381e5d` | Regeneración de audio expuesta tras reutilizar traducción |
| `103a163` | Validación de frescura del audio antes del preview |
| `e89d5af` | Renderizado consistente de Markdown |
| `cd0fb4a` | Markdown endurecido y transiciones TTS españolas |
| `6147410` | Instalación de dependencias antes de reiniciar publicador |
| `bec7d6d` | Regeneración de audio por idioma |
| `356c290` | Bloques continuos de narración ElevenLabs con pausas nativas |
| `305c6d4` | Estado explícito del trabajo de audio español en la UI |
| `c791f67` | Caché persistente y reanudación por bloques de ElevenLabs |
| `b94d695` | Corrección del contador de tiempo de regeneración |

## 4. Servidores, servicios externos y direcciones

### 4.1 Papabear

- Alias SSH local: `papabear`.
- Hostname requerido por scripts administrativos: `papabear`.
- IP privada NetBird: `100.121.48.92`.
- Usuario administrativo: `sysadmin`.
- Usuario de servicio: `fanaticosos-blog` (sin shell interactivo y sin sudo).
- Sistema base documentado: Ubuntu 24.04.4 LTS, amd64.
- Capacidad documentada: 12 vCPU, 31 GiB RAM utilizable, 8 GiB swap.
- Publicador privado: `http://100.121.48.92:4310/`.
- El publicador se enlaza específicamente a la IP NetBird, no a una interfaz pública.

Acceso desde la Mac autorizada:

```bash
ssh papabear
```

La entrada local correspondiente está en `~/.ssh/config` y apunta a:

```text
Host papabear
HostName 100.121.48.92
User sysadmin
IdentityFile ~/.ssh/id_fanaticosos_blog
```

No se debe ejecutar Git como `root` en el repositorio. El patrón correcto en Papabear es:

```bash
sudo -u fanaticosos-blog git -C /opt/fanaticosos-blog/repository ...
```

Ejecutarlo con `sudo git` causó `detected dubious ownership` y además hizo que el alias SSH del usuario de servicio no estuviera disponible.

### 4.2 GitHub

- Alias SSH de la Mac: `github-fanaticosos`.
- Host real: `github.com`.
- Usuario SSH: `git`.
- Llave privada local: `~/.ssh/id_ed25519_fanaticosos`.
- El deploy key de Papabear está asociado al usuario `fanaticosos-blog`; su ruta exacta en Papabear no fue inspeccionada en este hilo y debe verificarse.
- El remoto de Papabear observado usa el alias `github-fanaticosos-web`; su definición y `IdentityFile` deben inventariarse directamente en `/opt/fanaticosos-blog/.ssh/config` o la ubicación efectiva del HOME del servicio.

### 4.3 Cloudflare

- Proyecto Pages: `fanaticosos-web`.
- Cuenta observada por los scripts: `500cc7e82e34b5837b06a22ffee9f162`.
- Dominios de producción validados por el script:
  - `https://fanaticosos.com`
  - `https://www.fanaticosos.com`
  - `https://fanaticosos-web.pages.dev`
- Previews: ramas inmutables con forma `papabear-preview-<8 hex>` y URLs `https://papabear-preview-<8 hex>.fanaticosos-web.pages.dev`.
- Los previews pueden estar protegidos por Cloudflare Access.
- Credencial del servidor: `/etc/fanaticosos-blog/cloudflare-pages.env`, `root:root`, modo `0600`.
- El script espera `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT` y `CLOUDFLARE_API_TOKEN`.
- D1 mostrado inicialmente en la consola: `d42195be-4ff3-42cf-854d-f681536a244f`.
- El helper contiene una comprobación de binding de producción con D1 `6bbd7721-7b4e-4280-ba01-3ef35ca82d53`.
- **Conflicto pendiente:** determinar si esas dos IDs representan bases distintas (por ejemplo, mapa vs. otra función) o una configuración obsoleta.

Último despliegue de producción observado en el hilo:

- URL inmutable: `https://2eaf289d.fanaticosos-web.pages.dev`.
- Rollback deployment ID: `67bc5337-ab22-4956-91d8-c95ec077b0dc`.
- La fuente exacta/manifest del release debe verificarse antes de afirmar qué commit está actualmente en producción.

### 4.4 ElevenLabs

- Servicio externo de TTS español.
- Credencial en Papabear: `/etc/fanaticosos-blog/elevenlabs.env`, esperada como `root:root` modo `0600`.
- Configuración versionada: `config/tts/elevenlabs-production.json`.
- Configuración al corte:
  - voz: `Will - Relaxed Optimist`;
  - modelo: `eleven_multilingual_v2`;
  - formato: `mp3_44100_128`;
  - límite propio de bloque: 4,500 caracteres;
  - versión de configuración: 5;
  - versión de pronunciaciones: 14.
- El saldo global de la cuenta y el límite por API key son controles diferentes.
- Fallo observado con key limitada a 40,000 créditos: quedaban 68 y el siguiente bloque requería 2,322.
- ElevenLabs Studio vive en la nube de ElevenLabs; no vive en Papabear. Su integración automática no está implementada.

### 4.5 Otros proveedores/configuraciones presentes

- Azure Speech: `/etc/fanaticosos-blog/azure-speech.env`.
- OpenAI: `/etc/fanaticosos-blog/openai.env`.
- Cloudflare Pages: `/etc/fanaticosos-blog/cloudflare-pages.env`.
- Navidrome: utilizado para resolver/publicar la canción semanal; ruta privada y credenciales exactas no fueron inventariadas en esta conversación.
- Traducción principal actual: Qwen local mediante `llama.cpp`, no una API externa.

## 5. Ubicación de credenciales y reglas de seguridad

### Mac del administrador

| Propósito | Ruta |
|---|---|
| SSH a Papabear | `~/.ssh/id_fanaticosos_blog` |
| SSH a GitHub Fanaticosos | `~/.ssh/id_ed25519_fanaticosos` |
| Alias y selección de llaves | `~/.ssh/config` |
| Host keys conocidas | `~/.ssh/known_hosts` |

### Papabear

| Propósito | Ruta esperada | Dueño/modo esperado |
|---|---|---|
| ElevenLabs | `/etc/fanaticosos-blog/elevenlabs.env` | `root:root 0600` |
| Azure Speech | `/etc/fanaticosos-blog/azure-speech.env` | `root:root 0600` |
| OpenAI | `/etc/fanaticosos-blog/openai.env` | `root:root 0600` |
| Cloudflare Pages | `/etc/fanaticosos-blog/cloudflare-pages.env` | `root:root 0600` |
| GitHub deploy key | no verificado; bajo el HOME/SSH del usuario de servicio | privado, no legible por otros |

Reglas:

- No imprimir el contenido de estos archivos en logs, tickets o Git.
- Los instaladores reciben secretos por entrada estándar y los guardan con alcance root.
- El repositorio no debe contener valores de tokens.
- La recuperación en otra VM requiere un respaldo cifrado y externo de estos secretos o un proceso documentado para volver a emitirlos. Eso todavía no está probado.

## 6. Arquitectura lógica

```text
Administrador (Mac + NetBird)
        |
        | SSH / navegador privado
        v
Papabear 100.121.48.92
  +-- publisher :4310 (Node, usuario fanaticosos-blog)
  |     +-- SQLite: borradores, revisiones, estado y metadatos
  |     +-- artefactos privados: traducciones, audio, releases
  |     +-- cola privada
  |
  +-- dispatcher systemd
  |     +-- translation@.service -> Qwen local / llama.cpp
  |     +-- tts@.service -> router -> ElevenLabs ES o Kokoro EN
  |     +-- audiogram@.service -> video
  |     +-- release@.service -> build inmutable
  |     +-- production-deploy@.service -> Cloudflare Pages
  |
  +-- caché ElevenLabs por bloques
  +-- backups SQLite
        |
        v
Cloudflare Pages + Functions + D1
        |
        v
fanaticosos.com / previews protegidos
```

## 7. Disposición de archivos en Papabear

```text
/opt/fanaticosos-blog/
├── repository/                         # checkout Git
├── jobs/                               # solicitudes/resultados temporales acotados
├── models/                             # Qwen, Kokoro y candidatos locales
├── runtimes/                           # entornos Python
├── tools/                              # llama.cpp y herramientas fijadas
├── publisher/
│   ├── database/publisher.sqlite       # autoridad SQLite
│   ├── backups/database/               # copias SQLite verificables
│   ├── artifacts/translations/         # traducciones aceptadas
│   ├── artifacts/audio/                # audios aceptados
│   ├── cache/tts/elevenlabs/            # bloques MP3 persistentes
│   ├── queue/                          # activación del dispatcher
│   ├── releases/                       # bundles y recibos
│   ├── states/                         # compatibilidad/estados de filesystem
│   ├── uploads/                        # archivos cargados
│   └── notifications/                  # actividad del publicador
└── work/                               # diagnósticos y benchmarks
```

Integración fuera de `/opt`:

- `/etc/systemd/system/fanaticosos-*.service|path|timer`
- `/usr/local/sbin/fanaticosos-blog-admin`
- `/usr/local/sbin/fanaticosos-publisher-dispatcher`
- `/etc/sudoers.d/` para el helper restringido
- `/etc/fanaticosos-blog/*.env` para secretos
- `/opt/nodejs/current` para Node fijado
- journal de systemd para logs

## 8. Servicios systemd

### Persistentes

- `fanaticosos-publisher.service`: publicador privado en NetBird.
- `fanaticosos-publisher-dispatcher.path`: observa `.wake` en la cola.
- `fanaticosos-stream-boot-recovery.service`: recuperación de bindings de streaming.
- `fanaticosos-stream-transcoder.service`: transcodificador SRT de Site B.
- Timers observados: Game Center, retención de releases y watchdog de streaming.

### Plantillas bajo demanda

- `fanaticosos-translation@.service`
- `fanaticosos-tts@.service`
- `fanaticosos-audiogram@.service`
- `fanaticosos-release@.service`
- `fanaticosos-production-deploy@.service`
- `fanaticosos-music-release@.service`
- `fanaticosos-music-deploy@.service`

Los estados `failed` de instancias históricas aparecen en `systemctl list-units --all` hasta resetearse; no prueban por sí mismos que el servicio persistente actual esté roto.

### Límites relevantes de TTS

- `RuntimeMaxSec=15min`
- `MemoryMax=8G`
- `MemorySwapMax=1G`
- `Restart=no`
- Escritura limitada al job y a `/opt/fanaticosos-blog/publisher/cache/tts/elevenlabs`
- Entornos de Azure y ElevenLabs se cargan opcionalmente desde `/etc/fanaticosos-blog`.

## 9. Flujo editorial y de publicación

1. Crear/editar borrador español en el publicador privado.
2. Guardar revisión en SQLite.
3. Generar o reutilizar traducción inglesa aceptada.
4. Mantener guiones de narración independientes en español e inglés, sin Markdown.
5. Ejecutar preflight de nombres, lugares y términos NFL.
6. Generar o cargar audio español y generar audio inglés.
7. Validar checksum, tamaño, revisión, política y frescura de ambos audios.
8. Preparar release inmutable.
9. Desplegar preview en rama no productiva.
10. Revisión visual y auditiva autenticada.
11. Solo con autorización explícita, seleccionar release y desplegar producción.
12. Guardar recibo de deployment y rollback.

## 10. Traducción

- Worker local Qwen 3 8B Q4_K_M mediante `llama.cpp`.
- Modelo esperado: `/opt/fanaticosos-blog/models/qwen3-8b-gguf/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf`.
- Runtime esperado: `/opt/fanaticosos-blog/tools/llama.cpp-b10195/llama-b10195/llama-cli`.
- Glosario: `config/translation/glossary.json`.
- Tiempo máximo: 60 minutos.
- Red privada/deshabilitada para el worker.
- Se implementó separación entre texto editorial, traducción aceptada y guiones de narración.
- Objetivo de diseño: un cambio ajeno al texto no debe invalidar traducción/audio; un cambio textual debe invalidar solo dependencias verdaderas.

## 11. TTS actual y sus riesgos

### Flujo español implementado

1. El artículo/guion se transforma a texto de narración sin Markdown.
2. Se aplican normalizaciones y pronunciaciones versionadas.
3. Se divide por secciones/bloques.
4. Se envía cada bloque a ElevenLabs con contexto anterior/siguiente y pausas nativas.
5. Cada bloque exitoso se guarda inmediatamente en caché por hash.
6. FFmpeg concatena los MP3 y aplica `loudnorm`, sample rate, canal y bitrate.
7. Se valida el resultado y se publica atómicamente como artefacto privado.

### Hechos importantes

- Dividir **no reduce** los créditos de la primera generación completa.
- La caché solo puede reducir costo en reintentos o ediciones donde bloques idénticos se reutilicen.
- Antes de `c791f67`, un fallo podía desperdiciar los bloques ya pagados.
- Después de `c791f67`, cada bloque exitoso se conserva inmediatamente.
- La separación y posterior ensamblaje pueden afectar continuidad. El usuario oyó un corte a `5:19`; el corte de `5:53` sí se corrigió.
- El mismo texto ejecutado directamente en ElevenLabs no presentó el corte de `5:19`.
- La pronunciación española de `Bears` sonó como `beers` en una aparición, aunque otras apariciones fueron correctas.
- El ensamblaje observado utilizó FFmpeg con filtro `loudnorm=I=-16:TP=-1.5:LRA=11` y recodificación MP3.

### Trabajo `c78af3a9`

Job: `tts-es-18a4b2de9fbc416aab264b070bd9f625-r3-c78af3a9`.

Evidencia durante ejecución:

- Inicio real: `2026-09-14 20:45:27 UTC`.
- A los 2:15 estaba activo y ejecutando FFmpeg para concatenación final.
- Se observaron 10 bloques MP3 persistidos en la caché.
- El publicador mostraba `122:25` porque medía desde un estado de audio anterior, no desde el job actual.
- `b94d695` corrige el contador, pero al corte no hay evidencia pegada de que Papabear haya instalado ese commit.
- El resultado final de este job no fue confirmado en el hilo al redactar este archivo.

### Alternativas sugeridas, no implementadas

1. **Mantener caché, cambiar ensamblaje a PCM uniforme y concatenación sin pérdidas.** Reduce artefactos de codificación, pero conserva complejidad.
2. **Una sola llamada normal a ElevenLabs.** Multilingual v2 tiene límite por solicitud; puede no aceptar el artículo completo.
3. **ElevenLabs Studio/Audio Native.** El proveedor administra contenido largo y entrega un archivo final. Studio vive en ElevenLabs; la API puede requerir acceso especial. No está instalada ni integrada.
4. **Flujo manual inmediato:** generar/exportar en ElevenLabs y cargar el MP3 español al publicador. Es sencillo, pero no automático.
5. **Volver a un proveedor/local engine previo:** Azure/Kokoro permanecen en el repositorio, pero la calidad y pronunciación deben reevaluarse; no asumir que son reemplazo equivalente.

No se debe adoptar ninguna alternativa sin una comparación auditiva ciega, medición de costo, prueba de reintento y prueba de recuperación.

## 12. Incidentes y errores observados

### Acceso y Git

- Se ejecutó Git con `sudo`, causando `dubious ownership`.
- Se intentó `safe.directory` como root; después falló la resolución del alias `github-fanaticosos-web` porque root no tenía la configuración SSH correcta.
- Corrección operativa: Git debe ejecutarse como `fanaticosos-blog`.

### Preview y despliegues

- Se entregó inicialmente un enlace de preview viejo después de un nuevo commit; el usuario no veía cambios.
- Hubo `STOP: Validated release bundle is missing` al intentar usar un release ID que no estaba disponible.
- Los previews posteriores confirmaron explícitamente que producción no fue objetivo.
- Se efectuó posteriormente un despliegue validado de producción con URL y rollback registrados.

### Bears Nation / mapa

- Un registro `Monterrey, NL` apareció en el Pacífico.
- `ID_DEL_PIN` fue usado literalmente en SQL y SQLite lo interpretó como columna inexistente.
- Se identificó el registro `id=49`, estado `approved`.
- Se implementó validación aproximada de coordenadas y capacidad de reposicionar el marcador.
- Reauditoría cerrada: el backend redondea a una décima antes de consultar el `/reverse` público de Nominatim y exige tierra, país y coincidencia aproximada de ciudad.
- El registro histórico `id=49` fue confirmado en `fanaticosos-bears-nation` (`d42195be-4ff3-42cf-854d-f681536a244f`): El Paso, USA, `31.8,-106.4`, `approved`. Nominatim lo resolvió como El Paso, Texas, United States y la API pública devolvió el mismo marcador; no necesita corrección.

### Navegación y páginas bilingües

- Blog, Bears Nation, términos y contacto usaban logos, textos y posiciones diferentes.
- Se crearon `SiteNavigation.astro`, `InfoPageNavigation.astro` y `ContactDetails.astro` para compartir presentación.
- Contacto español/inglés tenía contenido/íconos diferentes; se unificó mediante componente compartido.
- Se desplegó y revisó un preview antes del deployment de producción observado.

### Markdown

- Las citas se publicaron como caracteres literales `> >` y no como `<blockquote>`.
- La vista privada y el release no compartían correctamente el mismo procesamiento.
- Se implementó `publisher/lib/article-markdown.mjs` y pruebas para encabezados, párrafos, énfasis, listas, citas multipárrafo, tablas, enlaces, HTML escapado y reparación de marcadores duplicados.
- Debe probarse con fixtures reales semanales y no solamente con casos unitarios.

### Traducción y regeneración

- Quitar el masthead editorial (`Por`, `Fecha`, `Ubicación`) provocaba retraducción y regeneración completa.
- Se separaron guiones de narración y dependencias para evitar invalidaciones ajenas al contenido narrado.
- Debe verificarse que el almacenamiento SQLite, preview, release y migración antigua usen exactamente las mismas revisiones de fuente.

### TTS y cuotas

- Primer fallo: key con límite 25,000, 246 créditos restantes, bloque siguiente requería 313.
- Segundo fallo: key con límite 40,000, 68 restantes, bloque siguiente requería 2,322.
- Se afirmó incorrectamente que el intento fallido no consumió créditos; en realidad, la solicitud final rechazada no consumió, pero bloques anteriores probablemente sí.
- Se afirmó de forma imprecisa que segmentar era “para ahorrar créditos”. Lo exacto: no reduce la primera generación; solo permite reutilización posterior si existe caché persistente.
- El worker anterior ignoraba la reutilización y borraba trabajo parcial; eso se corrigió en `c791f67`.
- La UI no mostraba claramente comienzo/fin; se añadió estado explícito en `305c6d4`.
- El contador usaba una fecha antigua y mostró más de 122 minutos cuando el job llevaba unos 2 minutos; corregido en `b94d695`.
- La calidad de transiciones aún no está aceptada.

### Base de datos y recuperación

- Inicialmente se buscó `/opt/fanaticosos-blog/data`, ruta inexistente. La base real está bajo `/opt/fanaticosos-blog/publisher/database`.
- Backup confirmado: `/opt/fanaticosos-blog/publisher/backups/database/db-20260914T183122Z.sqlite`.
- Dueño/modo confirmado: `fanaticosos-blog:fanaticosos-blog 0600`.
- Restore drill confirmó `integrity: ok` y migraciones 001, 002 y 003.
- Este backup vive en el mismo servidor; por sí solo no protege contra pérdida total de la VM/disco.

## 13. Pruebas y evidencia completada

### Automatizadas

- `npm run test:publisher`: 160 pruebas aprobadas en `b94d695`.
- Suite focal TTS jobs: 17 aprobadas.
- El trabajo de caché/reanudación reportó previamente 56 pruebas focales aprobadas.
- Existen suites adicionales para:
  - contenido y rutas Astro;
  - configuración del sitio;
  - Game Center;
  - participación/Turnstile;
  - ubicación y marcador del mapa;
  - contratos de traducción y TTS;
  - systemd y helper administrativo;
  - builds y políticas de medios.

### Operativas

- Publicador instalado y activo en NetBird después de `c791f67`.
- Plantilla TTS instalada desde `c791f6738dcd9e7c15a4cd59b4480afa2ab478d7`.
- Caché TTS confirmada: `fanaticosos-blog:fanaticosos-blog`, modo `0700`.
- `ReadWritePaths` de TTS incluye el job actual y la caché.
- Backup SQLite y restore drill aprobados.
- Preview de Cloudflare reportó que producción no fue objetivo.
- Deployment de producción reportó validación y rollback ID.

### No completadas o no documentadas

- Resultado final del job español `c78af3a9`.
- Revisión auditiva completa del MP3 nuevo, especialmente `5:19`.
- Prueba automática de ausencia de cortes audibles.
- Prueba de reintento real que demuestre `cacheHits > 0` sin gasto duplicado.
- Instalación confirmada de `b94d695` en Papabear.
- Rebuild completo de una VM limpia.
- Restauración desde backup fuera de Papabear.
- Rotación/restauración comprobada de todos los secretos.
- Inventario comprobado del deploy key GitHub dentro de Papabear.
- Resolución de la discrepancia entre IDs D1 observadas.

## 14. Estado de instalación conocido

- Papabear sincronizado e instalado hasta `c791f67`: **confirmado**.
- Publicador activo después de esa instalación: **confirmado**.
- Plantilla TTS de `c791f67`: **confirmada**.
- `b94d695` fue creado, probado y subido a la rama remota: **confirmado**.
- `b94d695` instalado en Papabear: **no confirmado**.
- Producción actual contiene todos los commits posteriores a `4e6ca51`: **no asumir**; verificar el manifest/receipt de producción.

## 15. Lista de tareas priorizada para reauditoría

### P0: preservar evidencia y evitar gasto/daño

- [ ] No iniciar otro TTS hasta registrar el resultado de `c78af3a9`.
- [ ] Copiar fuera de Papabear el backup SQLite verificado.
- [ ] Respaldar externamente, cifrados, los artefactos de audio aceptados y la caché TTS.
- [ ] Registrar saldo global de ElevenLabs, consumo del periodo y límite/uso de la API key.
- [ ] No desplegar producción durante la auditoría.

### P0: cerrar el incidente TTS actual

- [ ] Confirmar `result.json` o `failure.json` del job `c78af3a9`.
- [ ] Registrar `cacheHits`, `generatedChunks`, duración, checksum y costo real.
- [ ] Escuchar alrededor de `5:19` y `5:53` con audífonos y forma de onda.
- [ ] Comparar contra la generación manual de ElevenLabs usando exactamente texto, voz, modelo y settings.
- [ ] Determinar si el corte está en el MP3 de un bloque o aparece durante concat/loudnorm.
- [ ] No aceptar como resuelto hasta que una segunda persona pueda reproducir la prueba.

### P1: decidir una sola arquitectura TTS

- [ ] Definir criterio principal: calidad, automatización, costo, capacidad incremental y recuperación.
- [ ] Probar A/B: ensamblaje actual, PCM sin recodificación por frontera, llamada única cuando quepa y Studio/manual.
- [ ] Elegir una arquitectura y eliminar caminos experimentales no seleccionados.
- [ ] Mantener pronunciaciones/nombres/lugares versionados en cualquier alternativa.
- [ ] Añadir preflight de cuota antes de iniciar; el trabajo debe rechazar antes de consumir parcialmente si no hay capacidad estimada.
- [ ] Mostrar progreso por etapa y bloque, no un temporizador ambiguo.
- [ ] Añadir cancelación segura y estado terminal inequívoco.

### P1: recuperación y portabilidad

- [ ] Crear manifest versionado de paquetes, Node, Python, llama.cpp, modelos y checksums.
- [ ] Crear bootstrap idempotente para VM Ubuntu limpia.
- [ ] Crear inventario de secretos sin valores y procedimiento de inyección/rotación.
- [ ] Respaldar fuera de la VM: SQLite, artefactos aceptados, releases seleccionados, configuración privada y opcionalmente caché TTS.
- [ ] Implementar restore completo con verificación de ownership, modos, checksums, migraciones y systemd.
- [ ] Ejecutar restore drill en otra VM, no solo en un directorio temporal del mismo host.
- [ ] Documentar RPO, RTO y rollback.

### P1: datos y Cloudflare

- [ ] Inventariar cada D1 por nombre, ID, binding, entorno y propósito.
- [x] Confirmar qué D1 contiene `supporters` y el registro 49: `fanaticosos-bears-nation` (`d42195be-4ff3-42cf-854d-f681536a244f`).
- [ ] Exportar/respaldar D1 por separado; el backup SQLite de Papabear no incluye Cloudflare D1.
- [ ] Verificar Turnstile, Pages Functions, Access y variables de preview/producción.
- [ ] Confirmar el manifest exacto actualmente desplegado en producción.

### P2: contenido semanal

- [ ] Crear corpus de artículos reales con citas, listas, tablas, nombres y lugares.
- [ ] Probar render Markdown idéntico en editor, preview y release.
- [ ] Probar narración sin Markdown y con atribuciones/párrafos diferenciados.
- [ ] Agregar pruebas de regresión para `Bears`, Caleb Williams, Kyle Monangai, Bobby Okereke y términos NFL.
- [ ] Documentar quién aprueba traducción, pronunciación y audio antes de publicar.

### P2: mapa Bears Nation

- [x] Validar coordenadas redondeadas en backend, sin depender del navegador.
- [x] Comprobar tierra/agua y coherencia aproximada ciudad-país mediante el endpoint público versionado en código de Nominatim.
- [ ] Auditar registros existentes y corregir outliers.
- [ ] Diseñar panel administrativo posteriormente, con auditoría de cambios y sin acceso directo casual a D1.

## 16. Comandos de auditoría seguros y de solo lectura

Desde la Mac:

```bash
ssh papabear
```

En Papabear:

```bash
hostname
sudo /usr/local/sbin/fanaticosos-blog-admin publisher-status
sudo -u fanaticosos-blog git -C /opt/fanaticosos-blog/repository status --short --branch
sudo -u fanaticosos-blog git -C /opt/fanaticosos-blog/repository rev-parse HEAD
systemctl list-units --type=service --all 'fanaticosos-*' --no-pager
systemctl list-unit-files 'fanaticosos-*' --no-pager
sudo /usr/local/sbin/fanaticosos-blog-admin database-status "$(sudo -u fanaticosos-blog git -C /opt/fanaticosos-blog/repository rev-parse HEAD)"
```

No ejecutar durante una auditoría de solo lectura:

- `deploy-cloudflare-production`
- `repair-production-turnstile-binding`
- `run-release-retention`
- regeneraciones TTS repetidas
- cambios SQL directos sin backup y selección inequívoca de base/registro
- Git como root

## 17. Qué debe contener un paquete de recuperación real

1. Código Git por commit/tag firmado o hash completo.
2. Bootstrap de host y checksums de runtimes/modelos.
3. Backup SQLite externo y verificado.
4. Export/backup de cada Cloudflare D1.
5. Artefactos aceptados de audio, traducción y releases.
6. Secretos cifrados fuera de Git o procedimiento de reemisión.
7. Deploy key GitHub o procedimiento de creación/registro.
8. Units systemd, dispatcher, helper administrativo y sudoers desde Git.
9. Configuración NetBird y procedimiento para obtener una nueva IP si cambia el host.
10. Prueba end-to-end: abrir publicador, editar borrador, traducir, generar/cargar audio, preparar preview y verificarlo sin producción.

## 18. Criterios de aceptación antes de declarar el sistema estable

- Una VM nueva puede reconstruirse usando documentación y respaldos, sin conocimiento oral oculto.
- Ningún secreto está en Git y todos pueden restaurarse o rotarse.
- Un artículo semanal completo se procesa dos veces con resultados reproducibles.
- Cambiar un párrafo invalida solamente las dependencias documentadas.
- La narración española no tiene cortes perceptibles ni pronunciaciones conocidas incorrectas.
- La estimación de cuota impide empezar un trabajo que no puede terminar.
- Editor, preview y producción renderizan el mismo Markdown semántico.
- Preview nunca apunta a `main` ni a dominios productivos.
- Producción solo cambia mediante release validado, autorización explícita y rollback registrado.
- Los backups de Papabear y D1 existen fuera de los sistemas que protegen y pasan restore drills.

## 19. Declaraciones que no deben repetirse como hechos

- “Segmentar reduce el costo de la primera generación”: falso.
- “Un intento fallido no consume créditos”: falso en general; puede haber bloques previos cobrados.
- “El contador de la UI prueba cuánto lleva systemd”: fue falso antes de `b94d695`.
- “Studio está instalado o disponible por API”: no verificado/no implementado.
- “El backup SQLite permite recuperar todo”: falso; no incluye secretos, D1, integración de host ni necesariamente todos los artefactos.
- “La producción contiene el último commit de la rama”: no debe afirmarse sin manifest y receipt.
- “Las coordenadas son válidas porque el cliente las aceptó”: insuficiente; deben validarse en backend.

## 20. Referencias principales del repositorio

- `docs/PAPABEAR_BASELINE.md`
- `docs/TRANSLATION_DEPLOYMENT.md`
- `docs/TRANSLATION_JOB_CONTRACT.md`
- `docs/TTS_JOB_CONTRACT.md`
- `docs/CONTENT_MODEL.md`
- `deploy/admin/fanaticosos-blog-admin`
- `deploy/admin/fanaticosos-blog-admin.sudoers`
- `deploy/systemd/fanaticosos-publisher.service`
- `deploy/systemd/fanaticosos-translation@.service`
- `deploy/systemd/fanaticosos-tts@.service`
- `scripts/deployment/deploy_cloudflare_preview.sh`
- `scripts/deployment/deploy_cloudflare_production.sh`
- `publisher/server.mjs`
- `publisher/lib/database.mjs`
- `publisher/lib/article-markdown.mjs`
- `publisher/lib/narration-scripts.mjs`
- `publisher/lib/tts-jobs.mjs`
- `scripts/tts/render_article_elevenlabs.py`
- `config/tts/elevenlabs-production.json`
- `config/tts/pronunciations.json`

## 21. Nota final para el auditor

El código tiene numerosas protecciones útiles: usuarios separados, límites systemd, rutas de escritura estrechas, commits esperados, releases inmutables, checksums, backups SQLite, restore drill, previews no productivos y pruebas automatizadas. Eso no elimina los riesgos operativos descritos. La auditoría debe evaluar el sistema como conjunto y no asumir que una prueba unitaria o un mensaje `PASS` cubre recuperación, costos externos, calidad auditiva o estado real de producción.
