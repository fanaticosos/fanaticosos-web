# Publicación bilingüe de Fanaticosos

Este es el flujo operativo único del blog. El publicador privado vive en
`http://100.121.48.92:4310/` y solo es accesible por NetBird.

## Flujo editorial

1. Crear o abrir el borrador, completar el artículo en español y guardarlo.
2. Pulsar **Crear traducción al inglés**. La traducción se ejecuta en Papabear
   y puede continuar aunque se cierre el navegador.
3. Revisar el título, resumen y artículo en inglés. Revisar también los guiones
   de narración en español e inglés. Guardar cualquier corrección antes de
   continuar.
4. Pulsar **Generar ambos audios**. Este es el único paso que autoriza el gasto
   de ElevenLabs. El servidor rechaza solicitudes sin confirmación editorial.
5. Escuchar los dos audios completos. Si solo un idioma necesita cambios,
   regenerar únicamente ese idioma.
6. Pulsar **Preparar y abrir vista previa**. Comprobar ambas versiones del
   artículo, ambos reproductores, la imagen, enlaces y metadatos.
7. Pulsar **Publicar** solamente desde una vista previa validada. El despliegue
   conserva la versión anterior como rollback y valida las rutas públicas.

## Barreras automáticas

- Traducir no genera audio automáticamente.
- Editar el borrador o la traducción invalida los artefactos dependientes.
- TTS bilingüe exige la revisión actual guardada y `confirmReviewed: true`.
- ElevenLabs verifica antes de generar el saldo de cuenta, la caché reutilizable
  y el límite particular de la key, actualmente configurado en 120,000.
- Una traducción, audio, compilación o despliegue fallido nunca reemplaza el
  último sitio sano.
- Game Center prepara propuestas, pero no publica sin una acción explícita.

## Criterio de aceptación

Una publicación está terminada cuando existen una traducción aceptada, dos
audios vigentes, un release privado validado y un recibo de despliegue exitoso;
las rutas pública española e inglesa deben responder correctamente. Un job en
cola, una vista previa abierta o un push a Git no equivalen a publicación.

## Diagnóstico seguro

En Papabear, estos comandos son de solo lectura:

```bash
sudo /usr/local/sbin/fanaticosos-blog-admin publisher-status
sudo /usr/local/sbin/fanaticosos-blog-admin database-status EXPECTED_COMMIT
sudo /usr/local/sbin/fanaticosos-blog-admin elevenlabs-capacity-status EXPECTED_COMMIT
```

No se debe ejecutar Git como `root`; la sincronización se hace exclusivamente
mediante `fanaticosos-blog-admin sync EXPECTED_COMMIT`.
