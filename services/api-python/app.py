from __future__ import annotations

import base64
import json
import os
import queue
import re
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any, Generator

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "services" / "api-python" / "pipeline"
CACHE_DIR = ROOT / ".cache" / "wordeditor-api-python"
DEFAULT_PORT = int(
    os.environ.get("WORDEDITOR_PORT")
    or os.environ.get("WORDEDITOR_PY_PORT")
    or "8787"
)

app = FastAPI(title="wordEditor api-python", version="0.1.0")


def _safe_resolve(rel_path: str) -> Path | None:
    rel = Path(rel_path.replace("\\", "/").lstrip("/"))
    abs_path = (ROOT / rel).resolve()
    if not str(abs_path).startswith(str(ROOT.resolve())):
        return None
    return abs_path


def _sanitize_download_name(name: str) -> str:
    base = Path(name or "export.docx").name
    cleaned = re.sub(r"[^\w.\-()\u4e00-\u9fff\s]", "_", base).strip()
    if not cleaned:
        cleaned = "export.docx"
    if not cleaned.lower().endswith(".docx"):
        cleaned = f"{cleaned}.docx"
    return cleaned


def _sanitize_import_name(name: str) -> str:
    base = Path(name or "input.docx").name
    cleaned = re.sub(r"[^\w.\-()\u4e00-\u9fff\s]", "_", base).strip() or "input.docx"
    if not cleaned.lower().endswith(".docx"):
        cleaned = f"{cleaned}.docx"
    return cleaned


def _slugify(name: str) -> str:
    s = re.sub(r"\.docx$", "", name, flags=re.IGNORECASE).strip()
    s = re.sub(r"[\s\\/]+", "-", s)
    s = re.sub(r"[^\w\-\u4e00-\u9fff]", "", s)
    return s or "doc"


def _run_cmd(args: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    proc = subprocess.Popen(
        args,
        cwd=str(cwd or ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    out, err = proc.communicate()
    return proc.returncode or 0, out, err


def _sse(event: str, payload: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _pipe_script(script_name: str, *args: str) -> list[str]:
    script = PIPELINE / script_name
    return [os.sys.executable, str(script), *args]


def _emit_step_from_build_line(line: str) -> list[dict[str, Any]]:
    text = line.strip()
    events: list[dict[str, Any]] = []
    if not text:
        return events
    if "模板:" in text or text.startswith("输入:"):
        events.append({"id": "prepare", "status": "finish"})
        events.append({"id": "pandoc", "status": "process", "message": "Pandoc 转换中…"})
    if text == "完成。":
        events.append({"id": "pandoc", "status": "finish", "message": "DOCX 已生成"})
        events.append({"id": "structure", "status": "wait"})
    if "[后处理] 标题识别" in text or "[postprocess_headings]" in text:
        events.append({"id": "structure", "status": "process", "message": "标题与交叉引用…"})
    if "[postprocess_document] 完成" in text:
        events.append({"id": "structure", "status": "finish"})
    if "注入 OOXML" in text or "[postprocess_styles]" in text:
        if "完成" not in text:
            events.append({"id": "ooxml", "status": "process", "message": "注入 styles.yaml…"})
    if "[postprocess_styles] 完成" in text:
        events.append({"id": "ooxml", "status": "finish"})
    return events


def _stream_build_events(request_data: dict[str, Any]) -> Generator[bytes, None, None]:
    try:
        template_id = str(request_data.get("templateId") or "").strip()
        if not template_id:
            yield _sse("error", {"error": "templateId is required"})
            return

        entries = request_data.get("entries")
        md_rel = str(request_data.get("mdRelPath") or "").strip()
        markdown = str(request_data.get("markdown") or "")

        use_upload = isinstance(entries, list) and len(entries) > 0 and bool(md_rel)
        if not use_upload and not markdown.strip():
            yield _sse("error", {"error": "markdown 或 entries 必填"})
            return

        job_id = str(uuid.uuid4())
        work_dir = CACHE_DIR / job_id
        work_dir.mkdir(parents=True, exist_ok=True)

        if use_upload:
            yield _sse("step", {"id": "prepare", "status": "process", "message": f"写入 {len(entries)} 个文件…"})
            for item in entries:
                rel = str(item.get("relPath") or "").replace("\\", "/").lstrip("/")
                b64 = str(item.get("contentBase64") or "")
                target = (work_dir / rel).resolve()
                if not str(target).startswith(str(work_dir.resolve())):
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(base64.b64decode(b64.encode("utf-8"), validate=False))

            input_md = (work_dir / md_rel.replace("\\", "/").lstrip("/")).resolve()
            if not input_md.is_file():
                yield _sse("error", {"error": f"mdRelPath 未在上传列表中: {md_rel}"})
                return
            default_name = f"{input_md.stem}-{template_id}.docx"
            yield _sse("step", {"id": "prepare", "status": "finish"})
        else:
            yield _sse("step", {"id": "prepare", "status": "process", "message": "写入 Markdown…"})
            input_md = work_dir / "input.md"
            input_md.write_text(markdown, encoding="utf-8")
            default_name = f"export-{template_id}.docx"
            yield _sse("step", {"id": "prepare", "status": "finish"})

        output_docx = work_dir / "output.docx"
        file_name = _sanitize_download_name(str(request_data.get("fileName") or default_name))

        options = request_data.get("options") or {}
        provenance = request_data.get("provenance") or {}
        cmd = _pipe_script(
            "build.py",
            "-i",
            str(input_md),
            "-o",
            str(output_docx),
            "-t",
            template_id,
        )
        if options.get("noHtmlPipe"):
            cmd.append("--no-html-pipe")
        if options.get("noPostprocess"):
            cmd.append("--no-postprocess")
        if options.get("password"):
            cmd.extend(["--password", str(options.get("password"))])
        option_flags = (
            ("headerText", "--header-text"),
            ("headerAlign", "--header-align"),
            ("headerVerticalAlign", "--header-vertical-align"),
            ("footerText", "--footer-text"),
            ("footerAlign", "--footer-align"),
            ("footerVerticalAlign", "--footer-vertical-align"),
        )
        for key, flag in option_flags:
            if key in options and options[key] is not None:
                cmd.extend([flag, str(options[key])])
        if str(provenance.get("author") or "").strip():
            cmd.extend(["--author", str(provenance.get("author")).strip()])
        if str(provenance.get("remark") or "").strip():
            cmd.extend(["--remark", str(provenance.get("remark")).strip()])
        if str(provenance.get("title") or "").strip():
            cmd.extend(["--doc-title", str(provenance.get("title")).strip()])

        yield _sse("step", {"id": "pandoc", "status": "process", "message": "启动 Pandoc…"})

        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )

        q: queue.Queue[tuple[str, str] | tuple[str, None]] = queue.Queue()

        def _read(stream_name: str, stream: Any) -> None:
            for line in stream:
                q.put((stream_name, line.rstrip("\n")))
            q.put((stream_name, None))

        t_out = threading.Thread(target=_read, args=("stdout", proc.stdout), daemon=True)
        t_err = threading.Thread(target=_read, args=("stderr", proc.stderr), daemon=True)
        t_out.start()
        t_err.start()

        done_streams = 0
        while done_streams < 2:
            stream_name, line = q.get()
            if line is None:
                done_streams += 1
                continue
            yield _sse("log", {"line": line, "stream": stream_name})
            for ev in _emit_step_from_build_line(line):
                yield _sse("step", ev)

        code = proc.wait()
        if code != 0 or not output_docx.is_file():
            yield _sse("error", {"error": f"build failed: {code}"})
            return

        yield _sse(
            "done",
            {
                "jobId": job_id,
                "fileName": file_name,
                "downloadUrl": f"/api/build/download?jobId={job_id}&fileName={file_name}",
            },
        )
    except Exception as exc:
        yield _sse("error", {"error": str(exc)})


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "api-python", "repo": str(ROOT)}


@app.get("/api/tools")
def tools() -> dict[str, Any]:
    code, out, _ = _run_cmd(_pipe_script("tool_paths.py", "--json"), cwd=ROOT)
    if code == 0:
        try:
            data = json.loads(out)
            return data
        except Exception:
            pass
    return {
        "pandoc": {"ok": False, "path": None, "hint": "winget install --id JohnMacFarlane.Pandoc"},
        "python": {"ok": True, "path": os.sys.executable},
    }


@app.get("/api/templates")
def templates() -> JSONResponse:
    cfg_path = ROOT / "config" / "templates.json"
    if not cfg_path.is_file():
        raise HTTPException(500, "config/templates.json 不存在")
    data = json.loads(cfg_path.read_text(encoding="utf-8"))
    for t in data.get("templates", []):
        ref = ROOT / str(t.get("reference_doc") or "")
        t["reference_exists"] = ref.is_file()
    return JSONResponse(data)


@app.get("/api/templates/reference-styles")
def reference_styles(template: str = Query("")) -> JSONResponse:
    template_id = template.strip()
    if not re.match(r"^[\w-]+$", template_id):
        raise HTTPException(400, "template 参数缺失或非法")
    code, out, err = _run_cmd(
        _pipe_script("list_reference_styles.py", "-t", template_id, "--json"),
        cwd=ROOT,
    )
    if code != 0:
        raise HTTPException(500, err or "读取 reference styles 失败")
    return JSONResponse(json.loads(out))


@app.get("/api/docs")
def read_doc(name: str = Query("")) -> dict[str, str]:
    if not re.match(r"^[\w-]+\.md$", name):
        raise HTTPException(400, "invalid doc name")
    abs_path = _safe_resolve(f"docs/{name}")
    if abs_path is None or not abs_path.is_file():
        raise HTTPException(404, "doc not found")
    return {"content": abs_path.read_text(encoding="utf-8")}


@app.get("/api/file")
def read_file(path_param: str = Query("", alias="path")) -> dict[str, str]:
    abs_path = _safe_resolve(path_param)
    if abs_path is None or not abs_path.is_file():
        raise HTTPException(404, "file not found")
    return {"content": abs_path.read_text(encoding="utf-8")}


@app.put("/api/file")
async def write_file(request: Request, path_param: str = Query("", alias="path")) -> dict[str, bool]:
    abs_path = _safe_resolve(path_param)
    if abs_path is None:
        raise HTTPException(400, "invalid path")
    payload = await request.json()
    content = payload.get("content")
    if not isinstance(content, str):
        raise HTTPException(400, "content required")
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(content, encoding="utf-8")
    return {"ok": True}


@app.post("/api/preview/styles")
async def preview_styles(request: Request) -> dict[str, str]:
    data = await request.json()
    template_id = str(data.get("templateId") or "").strip()
    styles_yaml = str(data.get("stylesYaml") or "")
    if not template_id:
        raise HTTPException(400, "templateId is required")
    if not styles_yaml.strip():
        raise HTTPException(400, "stylesYaml is required")

    job_id = str(uuid.uuid4())
    work_dir = CACHE_DIR / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    styles_path = work_dir / "styles.yaml"
    styles_path.write_text(styles_yaml, encoding="utf-8")
    output_docx = work_dir / "output.docx"

    code, out, err = _run_cmd(
        _pipe_script(
            "preview_styles.py",
            "-t",
            template_id,
            "-o",
            str(output_docx),
            "--styles",
            str(styles_path),
        ),
        cwd=ROOT,
    )
    # 兼容：若模板目录无 preview-styles.md，回退到共享样例稿再套用传入 styles.yaml。
    if code != 0 or not output_docx.is_file():
        shared_preview = ROOT / "templates" / "hutb-shared" / "preview-styles.md"
        code2, out2, err2 = _run_cmd(
            _pipe_script(
                "build.py",
                "-i",
                str(shared_preview),
                "-o",
                str(output_docx),
                "-t",
                template_id,
            ),
            cwd=ROOT,
        )
        if code2 == 0 and output_docx.is_file():
            code3, out3, err3 = _run_cmd(
                _pipe_script(
                    "postprocess_styles.py",
                    str(output_docx),
                    "--styles",
                    str(styles_path),
                ),
                cwd=ROOT,
            )
            if code3 != 0:
                detail = "\n".join([x for x in [out, err, out2, err2, out3, err3] if x.strip()])
                raise HTTPException(500, f"style preview failed\n{detail}".strip())
        else:
            detail = "\n".join([x for x in [out, err, out2, err2] if x.strip()])
            raise HTTPException(500, f"style preview failed\n{detail}".strip())

    file_name = _sanitize_download_name(f"style-preview-{template_id}.docx")
    return {
        "jobId": job_id,
        "fileName": file_name,
        "downloadUrl": f"/api/build/download?jobId={job_id}&fileName={file_name}",
    }


@app.post("/api/build/stream")
async def build_stream(request: Request) -> StreamingResponse:
    data = await request.json()
    return StreamingResponse(_stream_build_events(data), media_type="text/event-stream")


@app.get("/api/build/download")
def build_download(jobId: str = Query(""), fileName: str = Query("export.docx")) -> FileResponse:
    if not re.match(r"^[\w-]+$", jobId):
        raise HTTPException(400, "invalid jobId")
    docx_path = CACHE_DIR / jobId / "output.docx"
    if not docx_path.is_file():
        raise HTTPException(404, "file not found or expired")
    safe_name = _sanitize_download_name(fileName)
    return FileResponse(
        str(docx_path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=safe_name,
    )


@app.post("/api/import/docx")
async def import_docx(request: Request) -> JSONResponse:
    data = await request.json()
    content_b64 = str(data.get("contentBase64") or "")
    if not content_b64:
        raise HTTPException(400, "contentBase64 is required")

    filename = _sanitize_import_name(str(data.get("filename") or "input.docx"))
    stem = re.sub(r"\.docx$", "", filename, flags=re.IGNORECASE) or "document"
    slug = str(data.get("imageSlug") or "").strip()
    if not re.match(r"^[\w\-\u4e00-\u9fff]+$", slug):
        slug = _slugify(stem)

    job_id = str(uuid.uuid4())
    work_dir = CACHE_DIR / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    docx_path = work_dir / filename
    md_path = work_dir / f"{stem}.md"
    image_dir = work_dir / "images" / slug
    image_rel = f"images/{slug}"

    docx_path.write_bytes(base64.b64decode(content_b64.encode("utf-8"), validate=False))

    code, out, err = _run_cmd(
        _pipe_script(
            "extract_docx_to_md.py",
            "-i",
            str(docx_path),
            "-o",
            str(md_path),
            "--image-dir",
            str(image_dir),
            "--image-rel",
            image_rel,
        ),
        cwd=ROOT,
    )
    if code != 0 or not md_path.is_file():
        raise HTTPException(500, f"extract failed\n{err or out}".strip())

    markdown = md_path.read_text(encoding="utf-8")
    entries: list[dict[str, Any]] = [
        {
            "relPath": f"{stem}.md",
            "contentBase64": base64.b64encode(markdown.encode("utf-8")).decode("utf-8"),
            "size": len(markdown.encode("utf-8")),
        }
    ]

    if image_dir.exists():
        for p in sorted(image_dir.rglob("*")):
            if not p.is_file():
                continue
            entries.append(
                {
                    "relPath": str(p.relative_to(work_dir)).replace("\\", "/"),
                    "contentBase64": base64.b64encode(p.read_bytes()).decode("utf-8"),
                    "size": p.stat().st_size,
                }
            )

    return JSONResponse(
        {
            "jobId": job_id,
            "fileName": f"{stem}.md",
            "mdRelPath": f"{stem}.md",
            "markdown": markdown,
            "entries": entries,
            "log": (out + "\n" + err).strip()[-4000:],
        }
    )


@app.get("/")
def root_info() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "api-python",
        "port": DEFAULT_PORT,
        "hint": "Run: py -m uvicorn app:app --app-dir services/api-python --reload --port 8787",
    }
