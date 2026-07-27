# Prueba Manual — Fase 1

> **⚠ Importante:** Este checklist debe ejecutarse en un navegador real.
> Ninguna prueba aquí fue ejecutada automáticamente desde el entorno CLI.
> Cada ítem debe marcarse manualmente como ✅ o ❌ después de verificar.

## Preparación

1. Iniciar servidor local:
   ```bash
   python -m http.server 8000
   ```
2. Abrir `http://localhost:8000` en Chrome o Firefox.
3. Abrir DevTools (`F12`):
   - **Consola**: monitorear errores.
   - **Application → IndexedDB**: inspeccionar `CatalogoAutomatizadoDB`.
   - **Network**: verificar que no haya solicitudes externas.

---

## Prueba A: Primer inicio

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| A1 | Abrir `http://localhost:8000` | Sin errores en consola | ☐ |
| A2 | Observar el encabezado | Aparece "Mi primer catálogo" | ☐ |
| A3 | Abrir Application → IndexedDB → CatalogoAutomatizadoDB → projects | Exactamente 1 proyecto | ☐ |
| A4 | Recargar la página (`F5`) 3 veces | Sin errores en consola | ☐ |
| A5 | Volver a revisar projects en IndexedDB | Sigue existiendo 1 solo proyecto (no se duplicó) | ☐ |
| A6 | Revisar `project.syncMetadata.status` | `"local"` | ☐ |
| A7 | Revisar `cloudProvider` y `cloudProjectId` | `null` ambos | ☐ |

---

## Prueba B: Crear producto

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| B1 | Llenar todos los campos: nombre, precio (5000), SKU (PROD-001), categoría (Electrónica), descripción | — | ☐ |
| B2 | Seleccionar una fotografía JPG de ≥ 3 MB | La previsualización se muestra inmediatamente | ☐ |
| B3 | Hacer clic en "Guardar producto" | Aparece notificación "Producto creado correctamente" | ☐ |
| B4 | Confirmar que aparece una tarjeta en la lista | Nombre, precio formateado como `$5.000`, SKU y categoría visibles | ☐ |
| B5 | Confirmar precio formateado con símbolo CLP (`$`) | Usa Intl.NumberFormat con es-CL | ☐ |
| B6 | Recargar la página | El producto persiste | ☐ |
| B7 | Revisar object store `images` en IndexedDB | 1 registro con `data` como Blob | ☐ |
| B8 | Revisar que el Blob en `data` no es idéntico al archivo original (debe ser más pequeño o tener dimensiones reducidas) | Verificar tamaño en bytes | ☐ |

---

## Prueba C: PNG con transparencia

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| C1 | Crear un producto nuevo | — | ☐ |
| C2 | Seleccionar un PNG que tenga transparencia en una zona distinta de la esquina superior (ej: esquina inferior derecha) | Previsualización correcta | ☐ |
| C3 | Guardar el producto | Notificación de éxito | ☐ |
| C4 | Recargar | El producto y la imagen persisten | ☐ |
| C5 | Abrir el object store `images`, inspeccionar el registro | `mimeType` debe ser `image/png` | ☐ |
| C6 | Verificar visualmente que la transparencia se conserva (no debe tener fondo blanco sólido donde debería ser transparente) | La transparencia se conserva | ☐ |

---

## Prueba D: Editar sin cambiar imagen

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| D1 | Hacer clic en "Editar" en la tarjeta del producto creado en la Prueba B | El formulario se carga con todos los datos | ☐ |
| D2 | Verificar que la previsualización de la imagen se muestra | La fotografía original aparece | ☐ |
| D3 | Cambiar el nombre a "Producto Editado" y el precio a "7500" | — | ☐ |
| D4 | Hacer clic en "Guardar cambios" | Notificación "Producto actualizado correctamente" | ☐ |
| D5 | Confirmar que la tarjeta muestra el nuevo nombre y precio | — | ☐ |
| D6 | Confirmar que la fotografía es la misma (no cambió) | — | ☐ |
| D7 | Revisar en IndexedDB → products → `revision` | Debe haber incrementado (era 1, ahora 2) | ☐ |
| D8 | Revisar `updatedAt` | Debe ser posterior a `createdAt` | ☐ |

---

## Prueba E: Cambiar imagen

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| E1 | Editar el mismo producto | — | ☐ |
| E2 | Hacer clic en "Cambiar imagen" | Se abre el selector de archivos | ☐ |
| E3 | Seleccionar una imagen diferente | La previsualización se actualiza | ☐ |
| E4 | Guardar | Notificación de éxito | ☐ |
| E5 | Confirmar que la nueva imagen aparece en la tarjeta | — | ☐ |
| E6 | Revisar object store `images` en IndexedDB | Debe haber 2 registros (la nueva imagen y la del PNG) | ☐ |
| E7 | Verificar que la imagen anterior (JPG grande) ya no está referenciada por ningún producto | `getImageUsageCount` = 0 → se eliminó | ☐ |
| E8 | Revisar que solo existen las imágenes del PNG y la nueva | La imagen JPG reemplazada fue eliminada | ☐ |

---

## Prueba F: Quitar imagen

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| F1 | Editar el producto con PNG transparente | — | ☐ |
| F2 | Hacer clic en "Quitar imagen" | La previsualización desaparece, se muestra placeholder | ☐ |
| F3 | Guardar cambios | Notificación de éxito | ☐ |
| F4 | Confirmar que la tarjeta ya no muestra fotografía (ícono de marcador) | — | ☐ |
| F5 | Revisar en IndexedDB → producto → `imageId` | `null` | ☐ |
| F6 | Revisar el object store `images` | La imagen PNG debe haber sido eliminada si ningún otro producto la referenciaba | ☐ |

---

## Prueba G: Duplicar

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| G1 | Duplicar el producto editado (de la Prueba D, que tiene imagen) | — | ☐ |
| G2 | Confirmar que aparece una nueva tarjeta con el nombre terminado en "Copia" | — | ☐ |
| G3 | Hacer clic en "Editar" en el producto duplicado | El formulario se abre en modo edición | ☐ |
| G4 | Verificar que el `id` del duplicado es diferente al original | Revisar en IndexedDB o en `data-product-id` del DOM | ☐ |
| G5 | Verificar que el `imageId` del duplicado es diferente al original | Revisar en IndexedDB (debe ser un ID nuevo) | ☐ |
| G6 | Confirmar que la imagen del duplicado se visualiza correctamente | — | ☐ |
| G7 | Eliminar el producto original | Confirmar eliminación | ☐ |
| G8 | Confirmar que el producto duplicado conserva su imagen | La tarjeta del duplicado sigue mostrando la fotografía | ☐ |
| G9 | Revisar object store `images` | La imagen del original pudo haber sido eliminada (si era la única referencia), la del duplicado debe seguir existiendo | ☐ |

---

## Prueba H: Eliminar

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| H1 | Eliminar el producto duplicado | — | ☐ |
| H2 | Confirmar la eliminación en el diálogo | — | ☐ |
| H3 | Confirmar que la tarjeta desaparece del listado | — | ☐ |
| H4 | Revisar object store `products` | El producto ya no existe | ☐ |
| H5 | Revisar object store `images` | La imagen de ese producto ya no existe (si era la única referencia) | ☐ |
| H6 | Confirmar que ningún otro registro fue afectado | — | ☐ |

---

## Prueba I: Validaciones

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| I1 | Hacer clic en "Guardar producto" sin nombre | Mensaje "El nombre es obligatorio" junto al campo | ☐ |
| I2 | Hacer clic en "Guardar producto" sin precio | Mensaje "El precio es obligatorio" junto al campo | ☐ |
| I3 | Ingresar precio negativo (-100) e intentar guardar | Mensaje "El precio debe ser igual o superior a cero" | ☐ |
| I4 | Seleccionar un archivo .gif (no permitido) | Mensaje "Formato no permitido: image/gif. Use JPEG, PNG o WebP." | ☐ |
| I5 | Seleccionar un archivo mayor a 15 MB | Mensaje "La imagen supera el tamaño máximo de 15 MB." | ☐ |
| I6 | Después de un error de validación, corregir y guardar | El formulario conserva los datos correctos | ☐ |
| I7 | Después de un error de archivo, seleccionar un JPG válido | El error de imagen se limpia, la previsualización se muestra | ☐ |

---

## Prueba J: Responsive

| # | Ventana | Verificaciones | Verificado |
|---|---|---|---|
| J1 | 1440 px | Sin scroll horizontal, formulario y listado en columnas, legible | ☐ |
| J2 | 1024 px | Transición a una columna, sin scroll horizontal | ☐ |
| J3 | 640 px | Controles apilados, campos de ancho completo, tarjetas de una columna | ☐ |
| J4 | 375 px | Sin scroll horizontal, botones pulsables, texto no cortado, encabezado reorganizado | ☐ |
| J5 | Todos | Estados de foco visibles al navegar con teclado (Tab) | ☐ |

---

## Prueba K: Consola y memoria

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| K1 | Crear 3 productos con imágenes diferentes | Sin errores en consola | ☐ |
| K2 | Editar cada uno cambiando la imagen 2 veces | Sin errores en consola | ☐ |
| K3 | Cancelar ediciones varias veces | Sin errores en consola | ☐ |
| K4 | Revisar la pestaña Network | Cero solicitudes a dominios externos (solo al servidor local) | ☐ |
| K5 | Revisar Performance / Memory (si está disponible) | No hay crecimiento anormal de memoria | ☐ |
| K6 | Abrir Application → Storage → IndexedDB | No hay acumulación de registros de imagen huérfanos | ☐ |

---

## Prueba L: Doble envío y operaciones repetidas

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| L1 | Crear un producto con nombre "Prueba L" | — | ☐ |
| L2 | Presionar "Guardar producto" rápidamente al menos 5 veces (clic) | Solo se crea 1 producto | ☐ |
| L3 | Repetir usando la tecla Enter 5 veces rápidamente | Solo se crea 1 producto | ☐ |
| L4 | Editar el producto y presionar "Guardar cambios" varias veces | Una sola revisión adicional (revision +1) | ☐ |
| L5 | Hacer clic en "Duplicar" rápidamente 3 veces | Solo 1 copia creada | ☐ |
| L6 | Hacer clic en "Eliminar" rápidamente 3 veces, confirmar solo la primera | Sin errores, sin notificaciones duplicadas | ☐ |
| L7 | Revisar IndexedDB → products | Exactamente 2 productos (original + copia) | ☐ |
| L8 | Revisar consola | Sin errores durante el flujo | ☐ |

---

## Prueba M: Consistencia de revisiones

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| M1 | Registrar `revision` inicial del proyecto (IndexedDB → projects) | — | ☐ |
| M2 | Crear un producto nuevo | — | ☐ |
| M3 | Confirmar `revision` del proyecto incrementó exactamente en 1 | project.revision = inicial + 1 | ☐ |
| M4 | Confirmar `syncMetadata.status = "pending"` | — | ☐ |
| M5 | Confirmar `lastCloudSync = null`, `cloudProvider = null`, `cloudProjectId = null` | — | ☐ |
| M6 | Editar el producto (cambiar nombre) | — | ☐ |
| M7 | Confirmar `revision` del proyecto incrementó exactamente en 1 | project.revision = anterior + 1 | ☐ |
| M8 | Confirmar `status = "pending"`, `lastLocalUpdate` cambió | — | ☐ |
| M9 | Duplicar el producto | — | ☐ |
| M10 | Confirmar `revision` del proyecto incrementó exactamente en 1 | — | ☐ |
| M11 | Confirmar `status = "pending"` | — | ☐ |
| M12 | Eliminar un producto | — | ☐ |
| M13 | Confirmar `revision` del proyecto incrementó exactamente en 1 | — | ☐ |
| M14 | Confirmar `status = "pending"` | — | ☐ |
| M15 | Confirmar que `lastCloudSync` sigue siendo `null` | — | ☐ |
| M16 | Confirmar que `cloudProvider` y `cloudProjectId` siguen `null` | — | ☐ |

---

## Prueba N: Falla transaccional controlada

Esta prueba requiere interrumpir la ejecución en un punto específico para simular un fallo. No quedan herramientas de desarrollo en el código.

### Método con DevTools (Chrome)

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| N1 | Abrir DevTools → Sources → `indexeddb-provider.js` | — | ☐ |
| N2 | Agregar un breakpoint en `createProductAtomic`, línea donde se hace `project.revision += 1` | — | ☐ |
| N3 | En la consola de DevTools, escribir: `indexedDB.deleteDatabase("CatalogoAutomatizadoDB")` para forzar cierre | Esto es solo ilustrativo; mejor usar el breakpoint | ☐ |
| N4 | Crear un producto nuevo desde la interfaz | La ejecución se pausa en el breakpoint | ☐ |
| N5 | En DevTools, cerrar la conexión a IndexedDB simulando una falla o simplemente reanudar y abortar manualmente | No es fácil abortar limpiamente desde DevTools | ☐ |
| N6 | **Alternativa documentada**: Revisar que en condiciones normales, si `project.revision += 1` falla (ej: proyecto no existe), la transacción se aborta | El método `createProductAtomic` verifica `if (!project) { t.abort(); reject(...); }` | ☐ |

### Verificación de consistencia

| # | Acción | Resultado esperado | Verificado |
|---|---|---|---|
| N7 | Después de cualquier operación normal, verificar que producto, imagen y proyecto están consistentes | — | ☐ |
| N8 | Verificar que el número de productos en IndexedDB coincide con el número de tarjetas visibles | — | ☐ |
| N9 | Verificar que cada `imageId` en productos tiene un registro correspondiente en `images` (o es null) | — | ☐ |
| N10 | Verificar que no hay registros en `images` sin al menos un producto que los referencie | — | ☐ |

---

## Prueba O: Reemplazo y limpieza at\u00f3mica

| # | Acci\u00f3n | Resultado esperado | Verificado |
|---|---|---|---|
| O1 | Crear un producto con imagen A | Registrar imageId del producto | ☐ |
| O2 | Editar y reemplazar imagen A con imagen B | — | ☐ |
| O3 | Confirmar que el producto apunta a un imageId *nuevo* (distinto de A) | — | ☐ |
| O4 | Revisar object store `images` | Imagen A ya no existe (si no ten\u00eda otras referencias). Imagen B existe. | ☐ |
| O5 | Recargar la p\u00e1gina | Imagen B contin\u00faa visible | ☐ |
| O6 | Quitar imagen B y guardar | — | ☐ |
| O7 | Confirmar `product.imageId === null` | — | ☐ |
| O8 | Confirmar que imagen B desapareci\u00f3 del store `images` | — | ☐ |
| O9 | Confirmar que project.revision aument\u00f3 exactamente 1 por cada acci\u00f3n (crear: +1, reemplazar: +1, quitar: +1) | 3 incrementos totales | ☐ |

---

## Prueba P: Edici\u00f3n obsoleta (conflicto de revisi\u00f3n)

Requiere dos pesta\u00f1as del navegador con la misma URL.

| # | Acci\u00f3n | Resultado esperado | Verificado |
|---|---|---|---|
| P1 | Abrir la app en Pesta\u00f1a 1 y Pesta\u00f1a 2 | — | ☐ |
| P2 | En Pesta\u00f1a 1, editar un producto y cambiar su nombre | — | ☐ |
| P3 | Guardar en Pesta\u00f1a 1 | \u00c9xito. product.revision se incrementa. | ☐ |
| P4 | **Sin recargar** la Pesta\u00f1a 2, editar el mismo producto (cargar\u00e1 revisi\u00f3n antigua) | — | ☐ |
| P5 | Modificar el precio en Pesta\u00f1a 2 y guardar | Debe aparecer mensaje de conflicto | ☐ |
| P6 | Confirmar que el producto **NO** se modific\u00f3 con los datos de Pesta\u00f1a 2 | — | ☐ |
| P7 | Confirmar que project.revision **NO** aument\u00f3 por el guardado fallido | — | ☐ |
| P8 | Confirmar que los datos escritos en Pesta\u00f1a 2 permanecen en el formulario | — | ☐ |
| P9 | Recargar la Pesta\u00f1a 2 | Debe aparecer la versi\u00f3n guardada en Pesta\u00f1a 1 | ☐ |

---

## Prueba Q: Producto eliminado durante edici\u00f3n

Requiere dos pesta\u00f1as.

| # | Acci\u00f3n | Resultado esperado | Verificado |
|---|---|---|---|
| Q1 | Abrir la app en Pesta\u00f1a 1 y Pesta\u00f1a 2 | — | ☐ |
| Q2 | En Pesta\u00f1a 1, editar un producto (cargar formulario) | — | ☐ |
| Q3 | En Pesta\u00f1a 2, eliminar ese mismo producto | — | ☐ |
| Q4 | En Pesta\u00f1a 1, intentar guardar los cambios | Debe aparecer mensaje: "Este producto ya no existe." | ☐ |
| Q5 | Confirmar que **NO** se cre\u00f3 un producto nuevo | — | ☐ |
| Q6 | Confirmar que **NO** qued\u00f3 una imagen hu\u00e9rfana nueva | — | ☐ |
| Q7 | Confirmar que project.revision **NO** aument\u00f3 por el guardado fallido | — | ☐ |
| Q8 | Confirmar que los datos escritos en Pesta\u00f1a 1 permanecen en el formulario | — | ☐ |

---

## Prueba R: Migraci\u00f3n de base de datos

| # | Acci\u00f3n | Resultado esperado | Verificado |
|---|---|---|---|
| R1 | Si existe una versi\u00f3n anterior, abrir la app nueva | — | ☐ |
| R2 | Revisar Application → IndexedDB → CatalogoAutomatizadoDB | DATABASE_VERSION debe ser 2 | ☐ |
| R3 | Revisar el store `products` → indices | Debe existir el \u00edndice `imageId` | ☐ |
| R4 | Confirmar que los productos anteriores siguen visibles en la interfaz | — | ☐ |
| R5 | Confirmar que las im\u00e1genes anteriores siguen visibles | — | ☐ |
| R6 | Si es una base nueva (sin datos previos), crear 2 productos | Sin errores en consola | ☐ |
| R7 | Confirmar ausencia de errores en consola durante la migraci\u00f3n o primer inicio | — | ☐ |

---

## Resumen de resultados

| Prueba | Estado | Notas |
|---|---|---|
| A: Primer inicio | ☐ | |
| B: Crear producto | ☐ | |
| C: PNG transparente | ☐ | |
| D: Editar sin cambiar imagen | ☐ | |
| E: Cambiar imagen | ☐ | |
| F: Quitar imagen | ☐ | |
| G: Duplicar | ☐ | |
| H: Eliminar | ☐ | |
| I: Validaciones | ☐ | |
| J: Responsive | ☐ | |
| K: Consola y memoria | ☐ | |
| L: Doble envío y operaciones repetidas | ☐ | |
| M: Consistencia de revisiones | ☐ | |
| N: Falla transaccional controlada | ☐ | |
| O: Reemplazo y limpieza at\u00f3mica | ☐ | |
| P: Edici\u00f3n obsoleta | ☐ | |
| Q: Producto eliminado durante edici\u00f3n | ☐ | |
| R: Migraci\u00f3n de base de datos | ☐ | |

---

*Documento generado el 27 de julio de 2026.*
*Ninguna prueba fue ejecutada automáticamente. Este checklist debe ejecutarse manualmente en navegador.*
