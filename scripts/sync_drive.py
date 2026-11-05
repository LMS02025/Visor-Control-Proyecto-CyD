"""Sincroniza el Libro de Obra Digital (carpeta de Google Drive) con data/*.json.

Uso (GitHub Actions o local):
    GDRIVE_SA_KEY='<json de la cuenta de servicio>' python scripts/sync_drive.py

- Lee las subcarpetas "FOLIO N" de la carpeta raíz y descarga solo los folios que aún no
  están en data/folios.json.
- Extrae los campos del PDF (prioridad, emisor, destinatario, fecha, tipo, asunto,
  referencias, adjuntos).
- Asigna al folio nuevo la materia del folio más reciente que cita; si no cita ninguno,
  queda en "M00 · Sin clasificar". En ambos casos queda marcado "revisar" para validación.
- La materia afectada pasa a estado "Por revisar" y la parte que debe responder se
  invierte respecto del emisor del folio nuevo.
"""
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = json.loads((ROOT / "scripts" / "config.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- parsing
def _field(t, name, nxt):
    m = re.search(name + r":\s*(.*?)\s*(?=" + nxt + r")", t, re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def emisor_de(por, texto):
    if por in CONFIG["inspeccion_fiscal"]:
        return "IF"
    if por in CONFIG["sociedad_concesionaria"]:
        return "SC"
    if re.search(r"Inspector(a)?\s+Fiscal(\s+Subrogante)?\s*(\n|$)", texto):
        return "IF"
    return "SC"


def limpiar_para(p):
    nombres = CONFIG["inspeccion_fiscal"] + CONFIG["sociedad_concesionaria"]
    hallados = sorted([n for n in nombres if n in p], key=p.find)
    return "; ".join(hallados) or p


def parse_folio(texto, numero):
    t = texto.replace("\\_", "_").replace("\\.", ".")
    rec = {"folio": numero}
    rec["prioridad"] = _field(t, "Prioridad", "Por:")
    rec["por"] = _field(t, r"\nPor", "Para:") or _field(t, "Por", "Para:")
    rec["para"] = limpiar_para(_field(t, "Para", "Fecha:"))
    m = re.search(r"Fecha:\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*Hora:\s*([\d:\s]+)", t)
    if m:
        rec["fecha"] = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
        rec["hora"] = re.sub(r"\s", "", m.group(4))
    else:
        rec["fecha"], rec["hora"] = datetime.now(timezone.utc).date().isoformat(), ""
    rec["tipo"] = _field(t, "Tipo Folio", "Asunto:")
    rec["asunto"] = _field(t, "Asunto", r"Observación:|$")
    refs_txt = _field(t, "Referencias Folios", "Tipo Folio:")
    rec["refs"] = ";".join(re.findall(r"(?:^|\)\s*|\s)(\d{1,4})\.\s", " " + refs_txt))
    adj = _field(t, "Adjuntos", "Referencias Folios:")
    rec["adjuntos"] = 0 if (not adj or "Sin adjuntos" in adj) else (
        len(re.findall(r"\.(?:pdf|docx?|xlsx?|kmz|kml|dwg|zip|rar|jpe?g|png|pptx?|mpp)\b", adj, re.I)) or 1)
    rec["emisor"] = emisor_de(rec["por"], t)
    return rec


def asignar_materia(rec, folios, materias):
    by_id = {int(f["folio"]): f for f in folios}
    citados = [int(r) for r in rec["refs"].split(";") if r and int(r) in by_id]
    if citados:
        base = by_id[max(citados)]
        rec["materia_id"], rec["materia"] = base["materia_id"], base["materia"]
    else:
        rec["materia_id"], rec["materia"] = "M00", "Sin clasificar"
        if not any(m["materia_id"] == "M00" for m in materias):
            materias.append({"materia_id": "M00", "materia": "Sin clasificar", "articulo": "—", "folios": "",
                             "estado": "Por revisar", "responde": "—", "situacion": "Folios nuevos que no citan antecedentes; requieren clasificación."})
    rec["revisar"] = True
    for m in materias:
        if m["materia_id"] == rec["materia_id"]:
            m["folios"] = ";".join(filter(None, [m.get("folios", ""), str(rec["folio"])]))
            m["estado"] = "Por revisar"
            m["responde"] = "SC" if rec["emisor"] == "IF" else "IF"
            m["situacion"] = f"Nuevo folio F{rec['folio']} ({rec['tipo'] or 'sin tipo'}): {rec['asunto']}"


# ---------------------------------------------------------------- Drive
def drive_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    info = json.loads(os.environ["GDRIVE_SA_KEY"])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/drive.readonly"])
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def listar(svc, q):
    out, token = [], None
    while True:
        r = svc.files().list(q=q, fields="nextPageToken, files(id, name, mimeType)", pageSize=1000,
                             pageToken=token, supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        out += r.get("files", [])
        token = r.get("nextPageToken")
        if not token:
            return out


def texto_pdf(svc, file_id):
    from googleapiclient.http import MediaIoBaseDownload
    from pypdf import PdfReader
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, svc.files().get_media(fileId=file_id, supportsAllDrives=True))
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    return "\n".join((p.extract_text() or "") for p in PdfReader(buf).pages)


HEARTBEAT_H = 3


def main():
    folios = json.loads((DATA / "folios.json").read_text(encoding="utf-8"))
    materias = json.loads((DATA / "materias.json").read_text(encoding="utf-8"))
    conocidos = {int(f["folio"]) for f in folios}
    svc = drive_service()
    carpetas = listar(svc, f"'{CONFIG['carpeta_drive']}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
    nuevos = []
    for c in carpetas:
        m = re.match(r"FOLIO\s+(\d+)$", c["name"].strip(), re.I)
        if not m or int(m.group(1)) in conocidos:
            continue
        n = int(m.group(1))
        pdfs = [f for f in listar(svc, f"'{c['id']}' in parents and mimeType='application/pdf' and trashed=false")
                if f["name"].lower() == f"folio-{n}.pdf"]
        if not pdfs:
            print(f"FOLIO {n}: sin folio-{n}.pdf, se omite", file=sys.stderr)
            continue
        rec = parse_folio(texto_pdf(svc, pdfs[0]["id"]), n)
        rec["enlace"] = f"https://drive.google.com/file/d/{pdfs[0]['id']}/view"
        nuevos.append(rec)
    for rec in sorted(nuevos, key=lambda r: r["folio"]):
        asignar_materia(rec, folios, materias)
        folios.append({k: rec.get(k, "") for k in ["folio", "fecha", "hora", "emisor", "por", "para", "tipo", "prioridad",
                                                    "materia_id", "materia", "asunto", "refs", "adjuntos", "enlace", "revisar"]})
        print(f"+ F{rec['folio']} {rec['fecha']} {rec['emisor']} → {rec['materia_id']}: {rec['asunto'][:70]}")
    folios.sort(key=lambda f: int(f["folio"]))
    if nuevos:
        (DATA / "folios.json").write_text(json.dumps(folios, ensure_ascii=False, indent=1), encoding="utf-8")
        (DATA / "materias.json").write_text(json.dumps(materias, ensure_ascii=False, indent=1), encoding="utf-8")
    ahora = datetime.now(timezone.utc)
    previo = json.loads((DATA / "meta.json").read_text(encoding="utf-8")) if (DATA / "meta.json").exists() else {}
    try:
        horas = (ahora - datetime.fromisoformat(previo["sincronizado"])).total_seconds() / 3600
    except (KeyError, TypeError, ValueError):
        horas = float("inf")
    # meta.json se reescribe con folios nuevos o, como testigo de funcionamiento, cada HEARTBEAT_H horas.
    # Así el visor distingue "sin novedades" de "sincronización caída" sin generar un commit cada 30 minutos.
    if nuevos or horas >= HEARTBEAT_H:
        meta = {"generado": previo.get("generado") if not nuevos and previo.get("generado") else ahora.isoformat(timespec="seconds"),
                "sincronizado": ahora.isoformat(timespec="seconds"),
                "carpeta_drive": CONFIG["carpeta_drive"], "folios": len(folios),
                "nuevos_ultima_sync": [r["folio"] for r in nuevos] if nuevos else previo.get("nuevos_ultima_sync", [])}
        (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(nuevos)} folio(s) nuevo(s); total {len(folios)}")


if __name__ == "__main__":
    main()
