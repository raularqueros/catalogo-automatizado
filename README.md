# Cat\u00e1logo Automatizado

## Objetivo de esta fase

Crear una aplicaci\u00f3n web est\u00e1tica y responsive que permita a emprendedores registrar productos con fotograf\u00edas, nombres, descripciones, c\u00f3digos, categor\u00edas y precios para posteriormente generar cat\u00e1logos comerciales con dise\u00f1os personalizables.

Esta fase (Fase 1) establece la base funcional con operaciones CRUD de productos, optimizaci\u00f3n de im\u00e1genes y almacenamiento local persistente mediante IndexedDB.

## Tecnolog\u00edas utilizadas

- HTML5
- CSS3 (variables CSS, diseño responsive)
- JavaScript vanilla (m\u00f3dulos ES)
- IndexedDB (almacenamiento local)
- APIs est\u00e1ndar del navegador (Canvas, File, Intl)
- Sin dependencias externas, frameworks, CDN ni herramientas de compilaci\u00f3n

## Estructura de archivos

```
/
\u251c\u2500\u2500 index.html           # P\u00e1gina principal
\u251c\u2500\u2500 styles.css            # Estilos globales con variables CSS
\u251c\u2500\u2500 app.js               # Punto de entrada y orquestaci\u00f3n
\u251c\u2500\u2500 README.md
\u251c\u2500\u2500 assets/
\u2502   \u2514\u2500\u2500 icons/              # Iconos (reservado para uso futuro)
\u2514\u2500\u2500 js/
    \u251c\u2500\u2500 config.js            # Configuraci\u00f3n centralizada
    \u251c\u2500\u2500 utils.js             # Utilidades (IDs, formato, fechas)
    \u251c\u2500\u2500 models/
    \u2502   \u251c\u2500\u2500 project-schema.js  # Modelo de proyecto (factory)
    \u2502   \u2514\u2500\u2500 product-schema.js  # Modelo de producto (factory)
    \u251c\u2500\u2500 services/
    \u2502   \u251c\u2500\u2500 product-service.js # L\u00f3gica de negocio de productos
    \u2502   \u251c\u2500\u2500 image-service.js   # Validaci\u00f3n y optimizaci\u00f3n de im\u00e1genes
    \u2502   \u2514\u2500\u2500 notification-service.js # Sistema de notificaciones
    \u251c\u2500\u2500 storage/
    \u2502   \u251c\u2500\u2500 storage-provider.js  # Contrato/interfaz de almacenamiento
    \u2502   \u251c\u2500\u2500 indexeddb-provider.js # Implementaci\u00f3n IndexedDB
    \u2502   \u2514\u2500\u2500 sync-manager.js     # Preparaci\u00f3n para sincronizaci\u00f3n futura
    \u2514\u2500\u2500 ui/
        \u251c\u2500\u2500 product-form.js    # Formulario de producto
        \u251c\u2500\u2500 product-list.js    # Listado de productos (tarjetas)
        \u2514\u2500\u2500 storage-status.js # Indicador de estado de almacenamiento
```

## Arquitectura local-first

La aplicaci\u00f3n sigue una arquitectura **local-first** que mantiene IndexedDB como almacenamiento operativo permanente, incluso cuando se incorpore Google Drive.

Diagrama conceptual de la arquitectura objetivo:

```
Interfaz (UI)
     \u2193
Servicios de dominio (product-service, image-service)
     \u2193
IndexedDbProvider (almacenamiento local operativo)
     \u2195
SyncManager (orquestaci\u00f3n local \u2194 remoto)
     \u2195
RemoteStorageProvider (futuro: Google Drive, Firebase, Supabase)
```

Reglas:

1. **IndexedDB** es la base de datos local primaria: cach\u00e9 y modo sin conexi\u00f3n. No ser\u00e1 reemplazado por Drive.
2. **Google Drive** ser\u00e1 un proveedor remoto sincronizado, no un reemplazo del almacenamiento local.
3. **SyncManager** coordina la comunicaci\u00f3n entre el almacenamiento local y el remoto.
4. **app.js** no intercambia IndexedDbProvider por DriveStorageProvider; ambos coexisten.
5. Los servicios de producto no esperan conexi\u00f3n de red para funcionar.
6. Una falla futura de Drive no impedir\u00e1 guardar localmente.
7. La aplicaci\u00f3n funciona completamente sin conexi\u00f3n a internet.
8. Los datos persisten al recargar o cerrar el navegador.

## Capa de almacenamiento

El sistema tiene dos contratos separados porque sus responsabilidades son diferentes:

### Almacenamiento local (operativo)

- **StorageProvider** (`storage-provider.js`): define el contrato que implementa IndexedDbProvider. Cubre operaciones CRUD completas para proyectos, productos e im\u00e1genes.
- **IndexedDbProvider** (`indexeddb-provider.js`): implementa el contrato usando IndexedDB con 4 object stores, \u00edndices y manejo de errores.

### Almacenamiento remoto (futuro)

- **RemoteStorageProvider** (`remote-storage-provider.js`): abstracci\u00f3n conceptual para proveedores remotos. Contempla: connect(), disconnect(), uploadImage(), downloadImage(), etc. No ejecuta operaciones reales todav\u00eda.

Regla arquitect\u00f3nica obligatoria: los componentes de interfaz nunca llaman directamente a `indexedDB.open()`, `IDBTransaction` ni `IDBObjectStore`. Toda persistencia pasa por la capa de almacenamiento.

## Estructura de IndexedDB

Base de datos: `CatalogoAutomatizadoDB`

| Versi\u00f3n | Cambios |
|---|---|
| 1 | Creaci\u00f3n inicial de stores |
| 2 (actual) | Adici\u00f3n del \u00edndice `imageId` en store `products` |

**Object stores:**

| Store      | KeyPath     | \u00cdndices                                      |
|------------|-------------|--------------------------------------------------|
| projects   | projectId   | -                                                |
| products   | id          | projectId, updatedAt, category, **imageId** (v2) |
| images     | imageId     | projectId                                        |
| metadata   | key         | -                                                |

### Migraci\u00f3n

La migraci\u00f3n de v1 a v2 agrega el \u00edndice `imageId` al store `products` sin eliminar ni recrear el store. Los datos existentes se conservan. El \u00edndice permite contar referencias a una imagen de manera eficiente durante las transacciones at\u00f3micas.

## Optimizaci\u00f3n de im\u00e1genes

Al seleccionar una imagen:

1. Se valida el tipo MIME (JPEG, PNG, WebP).
2. Se verifica el tama\u00f1o m\u00e1ximo (15 MB configurable).
3. Se lee mediante API del navegador y se obtienen sus dimensiones.
4. Se redimensiona si el lado m\u00e1s largo supera 1600 px (configurable), manteniendo la proporci\u00f3n.
5. Se genera una versi\u00f3n optimizada usando Canvas.
6. Se escanea el canal alfa completo del canvas redimensionado con salida temprana para detectar transparencia.
7. Si hay transparencia, se conserva PNG. Si no, se prefiere WebP cuando el navegador lo soporta; si no, JPEG.
8. Se aplica calidad 0.82 (configurable).
9. Se guarda el Blob optimizado (no el original).

### Nota sobre el hilo principal

El escaneo de transparencia (`_hasTransparency`) recorre el canal alfa del canvas en el **hilo principal**. No se mueve autom\u00e1ticamente a otro hilo por estar dentro de una funci\u00f3n `async`; `async` solo permite usar `await` para operaciones as\u00edncronas como `canvas.toBlob()`, pero el bucle de iteraci\u00f3n sobre los p\u00edxeles se ejecuta de forma s\u00edncrona.

Razones por las que el costo es aceptable en esta fase:

- El canvas tiene un tama\u00f1o m\u00e1ximo de 1600 px en el lado largo (\u2264 2.56 millones de p\u00edxeles).
- El recorrido tiene salida temprana: se detiene al encontrar el primer p\u00edxel transparente.
- En im\u00e1genes sin transparencia (la mayor\u00eda de fotograf\u00edas JPEG), recorre todos los p\u00edxeles. En el peor caso (1600\u00d71600), esto toma aproximadamente 10\u201330 ms en hardware moderno.
- No se congela la interfaz porque la operaci\u00f3n completa (optimizaci\u00f3n + escaneo) se ejecuta dentro de un manejador de evento as\u00edncrono, permitiendo que otros eventos se encolen.

Optimizaci\u00f3n futura posible: migrar el escaneo y la optimizaci\u00f3n a un Web Worker con OffscreenCanvas. No implementado en esta fase porque no existe un problema medible de rendimiento.

## Revisiones, fechas y control optimista

- Cada vez que se crea o modifica un producto, su `revision` se incrementa.
- Cada modificaci\u00f3n actualiza `updatedAt`.
- Cada operaci\u00f3n sobre un producto incrementa la `revision` del proyecto exactamente una vez.
- El proyecto mantiene `syncMetadata` con estado de sincronizaci\u00f3n (`local`, `pending`).
- **Control optimista de concurrencia**: al editar, el formulario conserva la `revision` original del producto. Al guardar, `updateProductAtomic` compara la revisi\u00f3n almacenada con la actual en base de datos. Si no coinciden (porque otro proceso o pesta\u00f1a modific\u00f3 el producto), la transacci\u00f3n se aborta y se muestra un mensaje de conflicto. El formulario conserva los datos ingresados.

### Comportamiento ante conflictos

| Situaci\u00f3n | Mensaje | Acci\u00f3n |
|---|---|---|
| Revisi\u00f3n obsoleta (producto editado por otro) | "Este producto cambi\u00f3 despu\u00e9s de que comenzaste a editarlo..." | No se guarda, formulario conserva datos |
| Producto eliminado durante edici\u00f3n | "Este producto ya no existe." | No se recrea, formulario conserva datos |
| Error transaccional | "Error al guardar: ..." | No se guarda, formulario conserva datos |

## Preparaci\u00f3n para Google Drive

La integraci\u00f3n con Google Drive a\u00fan no est\u00e1 implementada, pero la arquitectura est\u00e1 preparada:

- **SyncManager** (`sync-manager.js`) orquestar\u00e1 la comunicaci\u00f3n entre IndexedDbProvider y el futuro DriveStorageProvider.
- **RemoteStorageProvider** (`remote-storage-provider.js`) define el contrato conceptual que implementar\u00e1 DriveStorageProvider.
- IndexedDB **no ser\u00e1 reemplazado** por Drive. Drive ser\u00e1 un proveedor remoto sincronizado que opera en paralelo.

SyncManager en esta fase:
- Consulta el estado local (`local`, `pending`).
- Marca cambios como pendientes tras cada operaci\u00f3n.
- Mantiene `lastLocalUpdate`, `lastCloudSync`, `cloudProvider`, `cloudProjectId`.
- No ejecuta `fetch()`, no carga bibliotecas de Google, no abre ventanas OAuth.
- No muestra "Sincronizado" si no existe proveedor remoto.

El bot\u00f3n "Conectar Google Drive" est\u00e1 visible pero deshabilitado, indicando que estar\u00e1 disponible en una pr\u00f3xima actualizaci\u00f3n.

## Pruebas funcionales

Las pruebas funcionales requieren un navegador real. No existen pruebas automatizadas en esta fase.

Consulte `docs/PRUEBA_MANUAL_FASE_1.md` para el checklist detallado de verificaci\u00f3n manual, que incluye:

- Creaci\u00f3n, edici\u00f3n, duplicaci\u00f3n y eliminaci\u00f3n de productos.
- Verificaci\u00f3n de persistencia tras recarga.
- Validaci\u00f3n de transparencia PNG.
- Verificaci\u00f3n de optimizaci\u00f3n de im\u00e1genes.
- Pruebas de responsive (1440 px a 375 px).
- Revisi\u00f3n de consola y memoria.

**Nota:** Ninguna prueba funcional fue ejecutada autom\u00e1ticamente desde el entorno de desarrollo. Todas las pruebas deben ejecutarse manualmente en navegador.

## C\u00f3mo ejecutar localmente

Dado que la aplicaci\u00f3n utiliza m\u00f3dulos ES, debe servirse mediante un servidor HTTP local. No funciona correctamente abriendo `index.html` con `file://`.

### Opci\u00f3n 1: Python

```bash
python -m http.server 8000
```

Luego abrir en el navegador:

```
http://localhost:8000
```

### Opci\u00f3n 2: Node.js (si est\u00e1 disponible)

```bash
npx serve .
```

### Opci\u00f3n 3: VS Code Live Server

Si usa VS Code, instale la extensi\u00f3n "Live Server" y haga clic derecho en `index.html` > "Open with Live Server".

## Limitaciones actuales

- Solo un proyecto de cat\u00e1logo activo.
- Sin sincronizaci\u00f3n en la nube.
- Sin exportaci\u00f3n PDF.
- Sin plantillas visuales de cat\u00e1logo.
- Sin b\u00fasqueda, filtros ni paginaci\u00f3n.
- Sin categor\u00edas administrables.
- Sin importaci\u00f3n/exportaci\u00f3n de datos.
- Sin arrastrar y soltar para ordenar productos.
- Sin soporte PWA ni Service Worker.

## Funciones deliberadamente pendientes

Las siguientes funciones corresponden a fases posteriores y no est\u00e1n implementadas:

- Conexi\u00f3n real con Google Drive (OAuth, API)
- Exportaci\u00f3n a PDF
- Exportaci\u00f3n Excel/CSV
- Plantillas de cat\u00e1logo personalizables
- Portadas y logo empresarial
- B\u00fasqueda y filtros
- Variantes de producto e inventario
- Autenticaci\u00f3n y usuarios
- Sincronizaci\u00f3n en tiempo real

## Transacciones at\u00f3micas y consistencia

Todas las operaciones que modifican producto, imagen y proyecto se ejecutan dentro de una **\u00fanica transacci\u00f3n IndexedDB** (multi-store). Si alg\u00fan paso falla, la transacci\u00f3n se aborta y todos los cambios se revierten.

Los m\u00e9todos at\u00f3micos en `IndexedDbProvider` son:

- `createProductAtomic(product, imageRecord, projectId)`
- `updateProductAtomic(product, projectId, newImageRecord)`
- `duplicateProductAtomic(newProduct, newImageRecord, projectId)`
- `deleteProductAtomic(productId, imageId, projectId)`

### Lo que incluye cada transacci\u00f3n

| Operaci\u00f3n | Stores involucrados | Acciones dentro de la misma transacci\u00f3n |
|---|---|---|
| **Crear** | products + images + projects | Guardar imagen (opcional) + Guardar producto + Leer proyecto + Incrementar revision + Marcar pending |
| **Editar** | products + images + projects | Leer producto y verificar revisi\u00f3n esperada + Guardar nueva imagen (si replace) + Actualizar producto (campos, imageId, revision) + Leer proyecto + Incrementar revision + Marcar pending + **Eliminar imagen anterior usando \u00edndice imageId si count=0** |
| **Duplicar** | products + images + projects | Guardar copia de imagen (opcional) + Crear producto duplicado con imageId nuevo + Incrementar revision + Marcar pending |
| **Eliminar** | products + images + projects | Leer producto para obtener imageId + Eliminar producto + **Consultar \u00edndice imageId** + Eliminar imagen si count=0 + Leer proyecto + Incrementar revision + Marcar pending |

### Garant\u00edas

- Si falla la transacci\u00f3n, **no** queda imagen hu\u00e9rfana, producto parcial ni revisi\u00f3n incrementada.
- Si falla la transacci\u00f3n, **no** se muestra mensaje de \u00e9xito.
- Si falla la transacci\u00f3n, el formulario conserva los datos ingresados.
- La revisi\u00f3n del proyecto se incrementa exactamente una vez por operaci\u00f3n exitosa.
- El proyecto queda con `syncMetadata.status = "pending"` despu\u00e9s de cada mutaci\u00f3n.
- `lastCloudSync`, `cloudProvider` y `cloudProjectId` permanecen en `null` hasta que se implemente la sincronizaci\u00f3n remota.

## C\u00f3mo habilitar Google Drive

### 1. Crear un proyecto en Google Cloud Console

1. Ir a https://console.cloud.google.com/
2. Crear un proyecto nuevo o seleccionar uno existente.
3. Ir a **APIs & Services → Library**.
4. Buscar y habilitar **Google Drive API**.

### 2. Configurar pantalla de consentimiento OAuth

1. Ir a **APIs & Services → OAuth consent screen**.
2. Seleccionar **External** (o Internal si usas Google Workspace).
3. Completar: App name ("Cat\u00e1logo Automatizado"), User support email, Developer contact email.
4. Agregar el scope: `.../auth/drive.file`.
5. Agregar tu correo como **Test user**.

### 3. Crear OAuth Client ID

1. Ir a **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Tipo: **Web application**.
4. Name: "Cat\u00e1logo Automatizado Web".
5. **Authorized JavaScript origins**: `http://localhost:8000` (y la URL de producci\u00f3n cuando corresponda).
6. **Authorized redirect URIs**: dejar vac\u00edo (GIS maneja el flujo).
7. Copiar el **Client ID** generado.

### 4. Configurar en la aplicaci\u00f3n

Abrir `js/config.js` y reemplazar:

```js
GOOGLE_CLIENT_ID: 'REEMPLAZAR_CON_CLIENT_ID.apps.googleusercontent.com',
```

con el Client ID real.

### 5. Consideraciones de seguridad

- El Client ID es un identificador p\u00fablico, no un secreto.
- **No** incluir Client Secret en la aplicaci\u00f3n.
- El token de acceso se guarda **solamente en memoria** (no en localStorage ni IndexedDB).
- Al recargar la p\u00e1gina o al expirar el token, deber\u00e1s reconectar.
- La aplicaci\u00f3n solicita solo el scope `drive.file` (acceso solo a archivos creados por la app).
- No se necesita API Key para OAuth.

**Google Drive no est\u00e1 conectado por defecto.** La aplicaci\u00f3n funciona completamente en modo local sin configurar Drive. La conexi\u00f3n es opcional y se inicia manualmente con el bot\u00f3n "Conectar Google Drive".
