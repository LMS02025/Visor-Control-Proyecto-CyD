# Visor Control Proyecto CyD

Panel de control del **Libro de Obra Digital, etapa de Construcción**, del Contrato de Concesión *Planta Desaladora para la Región de Coquimbo* (D.S. de Adjudicación N° 15/2026).

El visor consolida los folios intercambiados entre la Sociedad Concesionaria Desaladora de Panul S.A. (SC) y la Inspección Fiscal (IF). Los clasifica por materia contractual y artículo de las BALI, e identifica en cada materia qué parte debe actuar y cuántos días han transcurrido.

## Funcionalidades

| Elemento | Descripción |
|---|---|
| **Visualizar** | Menú de vistas: panel completo, acciones pendientes, gráficos de flujo, tiempo de respuesta IF, estado de materias, registro de folios y modo presentación (rotación automática cada 12 s). |
| **Actualizar** | Vuelve a leer `data/*.json`, recalcula los indicadores y anuncia con aviso visual y sonoro los folios nuevos. |
| **Barra de actualización** | Ciclo de 5 minutos con cuenta regresiva; al completarse, actualiza el contenido de forma automática. |
| **Sonido** | Señales generadas con Web Audio (sin archivos externos), con botón para silenciarlas. El navegador habilita el audio después del primer clic en la página. |
| **Animación** | Entrada escalonada de tarjetas, contadores progresivos, barras con crecimiento animado y resaltado de folios nuevos. Se desactiva si el sistema operativo pide reducir el movimiento. |

## Estructura

```
index.html                  Visor (HTML + CSS + JS, sin dependencias de red)
assets/style.css, app.js    Estilos y lógica
vendor/d3.min.js            d3 v7
data/folios.json            Un registro por folio
data/materias.json          Materias contractuales, estado y parte que debe responder
data/meta.json              Fecha de la última sincronización
scripts/sync_drive.py       Sincronización Drive → data/
scripts/config.json         ID de la carpeta de Drive y firmantes de cada parte
.github/workflows/          Ejecución programada de la sincronización
```

## Publicación (GitHub Pages)

*Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`*.

El visor queda disponible en `https://<usuario>.github.io/Visor-Control-Proyecto-CyD/`. No funciona abierto como archivo local (`file://`): el navegador bloquea la lectura de los JSON. Para verlo en local, ejecute `python -m http.server` en la raíz.

## Sincronización automática con Google Drive

1. Comparta la carpeta `A_LIBRO_CONSTRUCCION` (Lector) con la cuenta de servicio, por ejemplo `github-drive-sync@…iam.gserviceaccount.com`.
2. En Google Cloud, genere una clave JSON para esa cuenta de servicio.
3. En el repositorio: *Settings → Secrets and variables → Actions → New repository secret*. Nombre `GDRIVE_SA_KEY`, valor: el contenido completo de la clave JSON.
4. El flujo **Sincronizar Libro de Obra desde Drive** se ejecuta cada 30 minutos y también puede lanzarse a mano desde *Actions*. Cuando encuentra folios nuevos, los agrega a `data/` y hace un commit. GitHub Pages republica el sitio y el visor los muestra en su siguiente ciclo de 5 minutos.

### Criterio de clasificación de folios nuevos

- El folio nuevo hereda la materia del folio más reciente que cita. Si no cita ninguno, queda en **M00 · Sin clasificar**.
- La materia afectada pasa a estado **Por revisar** y se invierte la parte que debe responder.
- El folio se marca con la etiqueta *Por revisar* en el registro.
- El estado definitivo (Aprobado, Observado, etc.) se fija editando `data/materias.json`, porque exige leer el pronunciamiento.

> La clasificación inicial de los folios 1 a 88 se hizo por lectura de su asunto, sus referencias y el texto del pronunciamiento, con corte al 03/11/2026. El extractor se validó sin diferencias contra el texto de 83 de esos folios. La primera ejecución con `pypdf` debe revisarse, porque la extracción de texto puede variar entre bibliotecas.
