# Visor Control Proyecto CyD

Panel de control del **Libro de Obra Digital, etapa de Construcción**, del Contrato de Concesión *Planta Desaladora para la Región de Coquimbo* (D.S. de Adjudicación N° 15/2026).

El visor consolida los folios intercambiados entre la Sociedad Concesionaria Desaladora de Panul S.A. (SC) y la Inspección Fiscal (IF). Los clasifica por materia contractual y artículo de las BALI, e identifica en cada materia qué parte debe actuar y cuántos días han transcurrido.

## Funcionalidades

| Elemento | Descripción |
|---|---|
| **Visualizar** | Menú de vistas: panel completo, acciones pendientes, estado de materias, registro de folios y modo presentación (rotación automática cada 12 s). |
| **Modo documentación** | Abre en claude.ai el panel documental de la carpeta `DOCUMENTACION`, con árbol, búsqueda y filtros. |
| **Actualizar** | Vuelve a leer `data/*.json`, recalcula los indicadores y anuncia con aviso visual y sonoro los folios nuevos. |
| **Barra de actualización** | Ciclo diario de lunes a viernes, con cuenta regresiva hasta las 08:00 (hora de Chile); en pausa sábado y domingo. Cada apertura o recarga trae los datos vigentes. |
| **Modo de visualización** | Tema Piedra con Azul marino. Botón que alterna entre los modos Día y Noche y recuerda la selección en el navegador. |
| **Sonido** | Señales generadas con Web Audio (sin archivos externos), con botón para silenciarlas. El navegador habilita el audio después del primer clic en la página. |
| **Animación** | Entrada escalonada de tarjetas, contadores progresivos, barras con crecimiento animado y resaltado de folios nuevos. Se desactiva si el sistema operativo pide reducir el movimiento. |

## Estructura

```
index.html                  Visor (HTML + CSS + JS, sin dependencias de red)
assets/style.css, app.js    Estilos y lógica
explorador/index.html       Explorador documental (código fuente, sin identificadores de Drive)
explorador/fondos/          Fotografías de fondo en rotación (visor y explorador)
vendor/d3.min.js            d3 v7
data/folios.json            Un registro por folio
data/materias.json          Materias contractuales, estado y parte que debe responder
data/meta.json              Fecha de la última sincronización
data/plazos.json            Plazos de respuesta de las BALI y regla aplicable a cada materia
scripts/sync_drive.py       Sincronización Drive → data/
scripts/config.json         ID de la carpeta de Drive y firmantes de cada parte
.github/workflows/          Ejecución programada de la sincronización
```

## Plazos contractuales de respuesta

`data/plazos.json` recoge los plazos que las BALI (versión refundida al 21-11-2025) fijan a cada parte para pronunciarse o responder, y asigna a cada materia la regla aplicable. Con ello, el visor calcula el vencimiento de cada materia pendiente desde la fecha de su último folio y lo muestra en la tabla de acciones pendientes, en dos indicadores (plazos vencidos y plazos que vencen en 7 días o menos).

- **Cómputo (art. 1.2.2 vi).** Los plazos se cuentan en días corridos, salvo que la BALI diga «días hábiles». Si el último día es inhábil, el plazo se prorroga al primer día hábil siguiente. Los festivos se registran en `festivos`.
- **Regla general (art. 1.10.1.2.1).** Rige para ingeniería, planes, programas y documentos que se remiten a este artículo (PGS, PGHC, Topografía y Exploración Geotécnica). La IF tiene 42 días desde la primera presentación y 21 días desde cada reingreso. La SC tiene hasta 21 días para responder las observaciones.
- **Reglas especiales.** PEPID: 30/30 días (art. 1.10.1.2). PEB: 20/20 días (art. 1.10.1.4.4). Gestor BIM: 10 días (art. 1.10.1.4.1). Revisor Estructural: 15 días (art. 1.10.1.3). Peritos Tasadores: 30 días para la IF (art. 1.10.2.1.3 c). Reposición: 5 días hábiles (art. 1.15.8).
- **Materias sin plazo propio.** Para M20 y M21 se aplica como referencia el art. 1.10.1.2.1, y el visor las rotula *(referencial)*. Para M06, M07 y M17 las BALI no fijan plazo de respuesta.
- **Materias nuevas.** Al crear una materia, agréguela en `materias` de `plazos.json` con su regla. Si falta, el visor muestra *Sin regla asignada*.

## Explorador documental

`explorador/index.html` contiene el código fuente del explorador de la carpeta `DOCUMENTACION`: árbol de series, búsqueda por nombre, ruta y contenido, filtros por tipo, fecha y propietario, y ficha de cada documento.

La página operativa está en [claude.ai](https://claude.ai/artifact/MFFk47NGSvPQMffjYbyyE7) y consulta Google Drive en modo lectura con el conector de quien la abre. La copia de este repositorio no accede a Drive y excluye deliberadamente los identificadores de carpeta, porque el repositorio es público. El marcador `__ID_CARPETA_DRIVE__` reemplaza al identificador real.

## Publicación (GitHub Pages)

*Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`*.

El visor queda disponible en `https://<usuario>.github.io/Visor-Control-Proyecto-CyD/`. No funciona abierto como archivo local (`file://`): el navegador bloquea la lectura de los JSON. Para verlo en local, ejecute `python -m http.server` en la raíz.

## Sincronización automática con Google Drive

**Método vigente: tarea programada de Claude, una vez al día de lunes a viernes a las 07:43 (hora de Chile); en pausa sábado y domingo.** La tarea lee la carpeta `A_LIBRO_CONSTRUCCION` con el conector de Google Drive y detecta las carpetas `FOLIO N` posteriores al último folio cargado. Lee cada `folio-N.pdf`, clasifica el folio por materia y artículo según su contenido y fija el estado de la materia según el pronunciamiento. Luego carga el lote con `scripts/cargar_folios.py`, verifica el visor y publica en `main`; Vercel republica el sitio.

- Cuando no hay folios nuevos, cada ejecución registra un testigo en `data/meta.json`. El visor advierte en rojo si, pasadas 2 h desde la última ejecución programada de un día hábil, no consta ese testigo; la advertencia indica que la tarea dejó de ejecutarse. El fin de semana no genera advertencia.
- Los folios cuya clasificación sea dudosa quedan marcados *Por revisar*.

**Método alternativo (inactivo): GitHub Actions + cuenta de servicio.** El flujo `sync-drive.yml` (`scripts/sync_drive.py`) solo puede ejecutarse a mano. Para reactivarlo, la cuenta dueña de la carpeta debe compartirla con una cuenta de servicio, la clave JSON debe cargarse en el secret `GDRIVE_SA_KEY` y la línea `schedule` debe descomentarse.

### Criterio de clasificación de folios nuevos

- El folio nuevo hereda la materia del folio más reciente que cita. Si no cita ninguno, queda en **M00 · Sin clasificar**.
- La materia afectada pasa a estado **Por revisar** y se invierte la parte que debe responder.
- El folio se marca con la etiqueta *Por revisar* en el registro.
- El estado definitivo (Aprobado, Observado, etc.) se fija editando `data/materias.json`, porque exige leer el pronunciamiento.

> La clasificación inicial de los folios 1 a 88 se hizo por lectura de su asunto, sus referencias y el texto del pronunciamiento, con corte al 03/11/2026. El extractor se validó sin diferencias contra el texto de 83 de esos folios. La primera ejecución con `pypdf` debe revisarse, porque la extracción de texto puede variar entre bibliotecas.
