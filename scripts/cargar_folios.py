"""Carga folios nuevos del Libro de Obra Digital en data/ a partir de un lote JSON.

Lo usa la tarea programada de Claude, que lee los PDF desde Google Drive con su conector,
clasifica cada folio por lectura de su contenido y entrega el resultado en este formato:

{
  "folios": [
    {"folio": 95, "fecha": "2026-11-06", "hora": "10:15", "emisor": "IF", "por": "Lorena Araya",
     "para": "Angel Achau", "tipo": "Notificación", "prioridad": "Media", "materia_id": "M19",
     "asunto": "...", "refs": "90;79", "adjuntos": 1, "enlace": "https://drive.google.com/file/d/<id>/view",
     "revisar": false}
  ],
  "materias": [
    {"materia_id": "M19", "estado": "Aprobado", "responde": "—", "situacion": "... (F95)."},
    {"materia_id": "M26", "materia": "Nueva materia", "articulo": "Art. x.y.z", "estado": "En revisión",
     "responde": "IF", "situacion": "..."}
  ]
}

Uso:  python scripts/cargar_folios.py lote.json      (lote vacío {"folios": [], "materias": []} = solo testigo)

Reglas: no sobrescribe folios ya cargados; agrega el número de folio a la lista de su materia;
crea la materia si no existe (exige materia, articulo); valida campos y valores; actualiza meta.json
(sincronizado = ahora) cuando hay folios nuevos o el último testigo tiene 3 h o más.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
HEARTBEAT_H = 3
CAMPOS = ["folio", "fecha", "hora", "emisor", "por", "para", "tipo", "prioridad",
          "materia_id", "materia", "asunto", "refs", "adjuntos", "enlace", "revisar"]
ESTADOS = {"Aprobado", "Aprobado con condiciones", "Cerrado", "En revisión", "Informativo",
           "Observado", "Sin pronunciamiento", "Por revisar"}


def falla(msg):
    sys.exit(f"ERROR: {msg}")


def main(ruta):
    lote = json.loads(Path(ruta).read_text(encoding="utf-8"))
    folios = json.loads((DATA / "folios.json").read_text(encoding="utf-8"))
    materias = json.loads((DATA / "materias.json").read_text(encoding="utf-8"))
    por_id = {m["materia_id"]: m for m in materias}
    conocidos = {int(f["folio"]) for f in folios}

    # Materias: altas y cambios de estado.
    for m in lote.get("materias", []):
        mid = m["materia_id"]
        if mid not in por_id:
            for k in ("materia", "articulo"):
                if not m.get(k):
                    falla(f"materia nueva {mid} sin '{k}'")
            por_id[mid] = {"materia_id": mid, "materia": m["materia"], "articulo": m["articulo"], "folios": "",
                           "estado": "", "responde": "", "situacion": ""}
            materias.append(por_id[mid])
        if m.get("estado") and m["estado"] not in ESTADOS:
            falla(f"estado no válido para {mid}: {m['estado']}")
        if m.get("responde") and m["responde"] not in {"IF", "SC", "—"}:
            falla(f"'responde' no válido para {mid}: {m['responde']}")
        por_id[mid].update({k: v for k, v in m.items() if k in ("materia", "articulo", "estado", "responde", "situacion") and v})

    # Folios nuevos.
    nuevos = []
    for f in sorted(lote.get("folios", []), key=lambda x: int(x["folio"])):
        n = int(f["folio"])
        if n in conocidos:
            print(f"F{n} ya existe; se omite")
            continue
        if f.get("emisor") not in {"IF", "SC"}:
            falla(f"F{n}: emisor debe ser IF o SC")
        try:
            datetime.strptime(f["fecha"], "%Y-%m-%d")
        except (KeyError, ValueError):
            falla(f"F{n}: fecha debe ser AAAA-MM-DD")
        mid = f.get("materia_id")
        if mid not in por_id:
            falla(f"F{n}: materia {mid} no existe; agréguela en 'materias'")
        rec = {k: f.get(k, "") for k in CAMPOS}
        rec["folio"], rec["materia"] = n, por_id[mid]["materia"]
        rec["adjuntos"] = int(f.get("adjuntos") or 0)
        rec["refs"] = ";".join(str(int(r)) for r in str(f.get("refs", "")).replace(",", ";").split(";") if r.strip())
        if not f.get("revisar"):
            rec.pop("revisar")
        folios.append(rec)
        conocidos.add(n)
        por_id[mid]["folios"] = ";".join(filter(None, [por_id[mid].get("folios", ""), str(n)]))
        nuevos.append(n)
        print(f"+ F{n} {rec['fecha']} {rec['emisor']} → {mid}: {rec['asunto'][:70]}")

    folios.sort(key=lambda x: int(x["folio"]))
    if nuevos or lote.get("materias"):
        (DATA / "folios.json").write_text(json.dumps(folios, ensure_ascii=False, indent=1), encoding="utf-8")
        (DATA / "materias.json").write_text(json.dumps(materias, ensure_ascii=False, indent=1), encoding="utf-8")

    ahora = datetime.now(timezone.utc)
    previo = json.loads((DATA / "meta.json").read_text(encoding="utf-8")) if (DATA / "meta.json").exists() else {}
    try:
        horas = (ahora - datetime.fromisoformat(previo["sincronizado"])).total_seconds() / 3600
    except (KeyError, TypeError, ValueError):
        horas = float("inf")
    if nuevos or lote.get("materias") or horas >= HEARTBEAT_H:
        meta = {"generado": ahora.isoformat(timespec="seconds") if nuevos else previo.get("generado", ahora.isoformat(timespec="seconds")),
                "sincronizado": ahora.isoformat(timespec="seconds"),
                "carpeta_drive": previo.get("carpeta_drive", "1q2xCr_9fskvGj0mr5VsSYdBaa6WFyalO"),
                "folios": len(folios), "nuevos_ultima_sync": nuevos or previo.get("nuevos_ultima_sync", []),
                "metodo": "Tarea programada de Claude (conector Google Drive)"}
        (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(nuevos)} folio(s) nuevo(s); total {len(folios)}; último folio F{max(conocidos)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        falla("uso: python scripts/cargar_folios.py lote.json")
    main(sys.argv[1])
