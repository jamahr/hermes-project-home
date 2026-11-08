"""Project Home backend, mounted by Hermes at ``/api/plugins/project-home/``.

The desktop half (``desktop/plugin.js``) runs on the user's machine; project folders live on the
machine the gateway runs on. These routes are the plugin's only door to those files.

Every file route takes a project id (or slug), looks it up in the profile's ``projects.db`` and
only touches files inside that project's registered folders: names are checked against a fixed
allow-list (or a single safe file name inside ``context/``), the target is resolved (symlinks
followed) and must stay under the project's primary folder, and existing symlinks are never
written through. Hermes applies authentication and the per-request profile scope before a request
reaches this module.

The dashboard imports this file by path (no parent package), so everything lives in one module.
"""

import os
import re
import sqlite3
import tempfile
import stat
import secrets
from contextlib import contextmanager
import time
import unicodedata
from contextlib import closing
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

PLUGIN_ID = "project-home"
VERSION = "0.2.0"

router = APIRouter()

# Context files Hermes injects from the session cwd, in the order it picks them (first non-empty
# wins; agent/prompt_builder.py). The Instructions row edits whichever of these Hermes will load.
INSTRUCTION_FILES = (".hermes.md", "HERMES.md", "AGENTS.override.md", "AGENTS.md", "agents.md", "CLAUDE.md", "claude.md")
DEFAULT_INSTRUCTIONS = "AGENTS.md"
MEMORY_FILE = "MEMORY.md"
NOTES_FILE = "PROJECT_NOTES.md"
EDITABLE_FILES = frozenset(INSTRUCTION_FILES + (MEMORY_FILE, NOTES_FILE))
CONTEXT_DIR = "context"

MAX_TEXT_BYTES = 1024 * 1024          # read/write cap for text files
MAX_UPLOAD_BYTES = 10 * 1024 * 1024   # context upload cap
MAX_CONTEXT_ENTRIES = 500
MAX_TITLE = 120
MAX_NAME = 120
MAX_CRON_FIELD = 4000

# One path segment: no separators, no control chars, not "." / "..", not hidden.
_SAFE_NAME_RE = re.compile(r"^[^/\\\x00-\x1f\x7f]{1,%d}$" % MAX_NAME)
_TEXT_EXTS = {
    ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".py", ".js", ".ts",
    ".html", ".css", ".xml", ".toml", ".ini", ".log", ".sh", ".sql", ".rst",
}


# ── helpers ──────────────────────────────────────────────────────────────────────────────────


def _hermes_home() -> Path:
    from hermes_constants import get_hermes_home

    return Path(get_hermes_home())


def _projects_root() -> Path:
    """Where new project folders go by default (``~/projects``)."""
    return Path.home() / "projects"


def slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:64].strip("-") or "project"


def _load_project(project: str):
    """The registered project for an id or slug, else 404."""
    project = str(project or "").strip()
    if not project or len(project) > 128:
        raise HTTPException(400, "project is required")
    from hermes_cli import projects_db as pdb

    with pdb.connect_closing() as conn:
        proj = pdb.get_project(conn, project)
    if proj is None:
        raise HTTPException(404, "no such project")
    return proj


def _project_root(proj) -> Path:
    """The project's primary folder, resolved. It must be one of the project's registered folders."""
    registered = [os.path.normpath(f.path) for f in (proj.folders or []) if getattr(f, "path", None)]
    primary = os.path.normpath(proj.primary_path) if proj.primary_path else (registered[0] if registered else "")
    if not primary or primary not in registered:
        raise HTTPException(409, "project has no registered folder")
    if not os.path.isabs(primary):
        raise HTTPException(409, "project folder is not absolute")
    return Path(primary)


def _inside(root: Path, target: Path) -> bool:
    try:
        return os.path.commonpath([str(root), str(target)]) == str(root)
    except ValueError:
        return False


def _check_segment(name: str) -> str:
    """One safe file name (no separators, no traversal, no hidden/control chars)."""
    name = unicodedata.normalize("NFC", str(name or "").strip())
    if not _SAFE_NAME_RE.match(name) or name in {".", ".."} or name.startswith("."):
        raise HTTPException(400, "invalid file name")
    return name


def confined(root: Path, *parts: str) -> Path:
    """``root/parts`` resolved, refusing anything that leaves ``root`` (traversal or symlink)."""
    for part in parts:
        if not part or part in {".", ".."} or "/" in part or "\\" in part or "\x00" in part or os.path.isabs(part):
            raise HTTPException(400, "invalid path")
    target = root.joinpath(*parts)
    resolved = target.resolve()
    if not _inside(root, resolved):
        raise HTTPException(400, "path escapes the project folder")
    return target


def _file_name(name: str) -> str:
    name = str(name or "").strip()
    if name not in EDITABLE_FILES:
        raise HTTPException(400, f"file must be one of: {', '.join(sorted(EDITABLE_FILES))}")
    return name


def _require_fd_support():
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY") or os.open not in os.supports_dir_fd:
        raise HTTPException(503, "secure filesystem operations unavailable")


@contextmanager
def _directory(root: Path, context: bool = False, create: bool = False):
    """Open each absolute path component without following symlinks; pin directory handles."""
    _require_fd_support()
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in root.parts[1:]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        if context:
            if create:
                try:
                    os.mkdir(CONTEXT_DIR, 0o755, dir_fd=fd)
                except FileExistsError:
                    pass
            nxt = os.open(CONTEXT_DIR, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        yield fd
    except FileNotFoundError:
        raise HTTPException(404, "folder not found")
    except OSError as exc:
        raise HTTPException(409, f"unsafe or inaccessible folder: {exc.strerror}")
    finally:
        os.close(fd)


def _stat(fd: int, name: str):
    try:
        st = os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(st.st_mode):
        raise HTTPException(400, "symlink not allowed")
    if not stat.S_ISREG(st.st_mode):
        raise HTTPException(409, "not a regular file")
    return st


def _read_text(fd: int, name: str, *, strict_utf8: bool = False) -> dict:
    st = _stat(fd, name)
    if st is None:
        return {"exists": False, "content": "", "size": 0, "mtime": None}
    try:
        handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except OSError:
        raise HTTPException(400, "unsafe file")
    with os.fdopen(handle, "rb") as fh:
        st = os.fstat(fh.fileno())
        if not stat.S_ISREG(st.st_mode):
            raise HTTPException(409, "not a regular file")
        data = fh.read(MAX_TEXT_BYTES + 1)
    if len(data) > MAX_TEXT_BYTES:
        raise HTTPException(413, "file is too large to show")
    if b"\x00" in data[:8192]:
        raise HTTPException(415, "binary file")
    try:
        content = data.decode("utf-8", errors="strict" if strict_utf8 else "replace")
    except UnicodeDecodeError:
        raise HTTPException(415, "file is not valid UTF-8")
    return {"exists": True, "content": content, "size": st.st_size, "mtime": st.st_mtime}


def _atomic_write(fd: int, name: str, data: bytes, *, exclusive: bool = False):
    st = _stat(fd, name)
    if exclusive and st is not None:
        raise HTTPException(409, "file already exists")
    tmp = ".ph-" + secrets.token_hex(16)
    handle = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(data)
            os.fchmod(fh.fileno(), (st.st_mode & 0o777) if st else 0o644)
        if exclusive:
            os.link(tmp, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
            os.unlink(tmp, dir_fd=fd)
        else:
            os.replace(tmp, name, src_dir_fd=fd, dst_dir_fd=fd)
    except FileExistsError:
        raise HTTPException(409, "file already exists")
    finally:
        try:
            os.unlink(tmp, dir_fd=fd)
        except FileNotFoundError:
            pass


def _write_if_missing(fd: int, name: str, text: str) -> bool:
    try:
        _atomic_write(fd, name, text.encode(), exclusive=True)
        return True
    except HTTPException as exc:
        if exc.status_code in (400, 409):
            return False
        raise


def _effective_instructions(fd: int) -> str:
    # Hermes chooses the first existing Hermes file even if empty; then falls back.
    hermes = next((n for n in INSTRUCTION_FILES[:2] if _stat(fd, n) is not None), None)
    names = ([hermes] if hermes else []) + list(INSTRUCTION_FILES[2:])
    for name in names:
        try:
            if _read_text(fd, name)["content"].strip():
                return name
        except HTTPException:
            continue
    return DEFAULT_INSTRUCTIONS


def _ancestor_instructions(root: Path) -> list[str]:
    """Read-only ancestor sources, respecting Hermes' git-root boundary and precedence."""
    dirs = [root, *root.parents]
    boundary = None
    for directory in dirs:
        try:
            with _directory(directory) as fd:
                try:
                    os.stat(".git", dir_fd=fd, follow_symlinks=False)
                    boundary = directory
                    break
                except FileNotFoundError:
                    pass
        except HTTPException:
            break
    if boundary is None:
        return []
    chain = dirs[:dirs.index(boundary) + 1]
    # First existing Hermes file stops the search, even if empty.
    for directory in chain:
        with _directory(directory) as fd:
            for name in INSTRUCTION_FILES[:2]:
                if _stat(fd, name) is not None:
                    content = _read_text(fd, name)["content"].strip()
                    if content:
                        return [str(directory / name)] if directory != root else []
                    chain = []
                    break
            else:
                continue
            break
    # Empty Hermes files fall back to the entire AGENTS chain.
    chain = dirs[:dirs.index(boundary) + 1]
    sources = []
    for directory in reversed(chain[1:]):
        with _directory(directory) as fd:
            for name in ("AGENTS.override.md", "AGENTS.md", "agents.md"):
                if _read_text(fd, name)["content"].strip():
                    sources.append(str(directory / name))
                    break
    return sources


def scaffold_texts(name: str, description: str) -> dict[str, str]:
    desc = (description or "").strip()
    agents = f"# {name}\n\n" + (f"{desc}\n\n" if desc else "") + (
        "## Working agreements\n"
        "- Read PROJECT_NOTES.md as user-authored high-level direction; it is not formal working instructions or an exhaustive plan. Do not rewrite it without a user request.\n"
        "- Read files in ./context/ for background before starting work.\n"
        "- Record durable decisions, facts and open questions for this project in ./MEMORY.md (append, dated).\n"
    )
    return {
        "AGENTS.md": agents,
        "MEMORY.md": f"# {name} — project memory\n",
        "PROJECT_NOTES.md": "# Project notes\n\n",
        "context/README.md": "Background material for this project. The agent reads these files before starting work.\n",
    }


def _project_dict(proj) -> dict:
    return {"id": proj.id, "slug": proj.slug, "name": proj.name, "description": proj.description,
            "primary_path": proj.primary_path, "archived": bool(proj.archived)}


# Board writes are serialized across gateway workers as well as threads.
import fcntl
import json
from typing import Literal

BOARD_STATUSES = ("Backlog", "To Do", "In Progress", "Done")

class BoardPatch(BaseModel):
    status: Optional[Literal["Backlog", "To Do", "In Progress", "Done"]] = None
    pinned: Optional[bool] = None


def _read_board() -> dict:
    path = _hermes_home() / "project-home" / "board.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != 1 or not isinstance(data.get("projects"), dict):
            raise ValueError("invalid schema")
        return data
    except FileNotFoundError:
        return {"version": 1, "projects": {}}
    except (ValueError, OSError) as exc:
        raise HTTPException(503, f"board unavailable: {exc}")


@router.get("/board")
def get_board() -> dict:
    return _read_board()


@router.put("/board/{project_id}")
def update_board(project_id: str, body: BoardPatch) -> dict:
    proj = _load_project(project_id)
    directory = _hermes_home() / "project-home"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (directory / ".board.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        board = _read_board()
        old = board["projects"].get(proj.id, {})
        pinned = body.pinned if body.pinned is not None else old.get("pinned", False)
        pinned_at = (old.get("pinned_at") or time.time()) if pinned else None
        board["projects"][proj.id] = {"status": body.status or old.get("status", "To Do"), "pinned": pinned, "pinned_at": pinned_at}
        with _directory(directory) as fd:
            _atomic_write(fd, "board.json", json.dumps(board, ensure_ascii=False).encode())
    return board


# ── routes ───────────────────────────────────────────────────────────────────────────────────


@router.get("/health")
def health() -> dict:
    return {"ok": True, "plugin": PLUGIN_ID, "version": VERSION}


@router.get("/project")
def project_info(project: str = Query(...)) -> dict:
    proj = _load_project(project)
    root = _project_root(proj)
    try:
        with _directory(root) as fd:
            instructions = _effective_instructions(fd)
            memory = _stat(fd, MEMORY_FILE) is not None
        with _directory(root, context=True):
            context = True
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        context = False
        if not root.is_dir():
            return {"project": _project_dict(proj), "root": str(root), "folder_exists": False,
                    "instructions_file": DEFAULT_INSTRUCTIONS, "has_memory": False, "has_context_dir": False}
    sources = _ancestor_instructions(root)
    return {"project": _project_dict(proj), "root": str(root), "folder_exists": True,
            "instructions_file": instructions, "has_memory": memory, "has_context_dir": context,
            "ancestor_instruction_sources": sources,
            "instructions_message": "Ancestor instructions may also apply or take precedence; they are read-only here." if sources else ""}


@router.get("/file")
def read_file(project: str = Query(...), name: str = Query(...)) -> dict:
    root = _project_root(_load_project(project))
    fname = _file_name(name)
    with _directory(root) as fd:
        return {"name": fname, **_read_text(fd, fname, strict_utf8=True)}


class FileBody(BaseModel):
    content: str = Field(max_length=MAX_TEXT_BYTES)
    expected_mtime: Optional[float] = None
    expected_exists: Optional[bool] = None


@router.put("/file")
def write_file(body: FileBody, project: str = Query(...), name: str = Query(...)) -> dict:
    root = _project_root(_load_project(project))
    fname = _file_name(name)
    data = body.content.encode("utf-8")
    if len(data) > MAX_TEXT_BYTES:
        raise HTTPException(413, "content too large")
    with _directory(root) as fd:
        st = _stat(fd, fname)
        if (body.expected_exists is not None and body.expected_exists != (st is not None)) or (body.expected_mtime is not None and st is not None and abs(st.st_mtime - body.expected_mtime) > 1e-3):
            raise HTTPException(409, "file changed on disk since it was opened; reload and try again")
        _atomic_write(fd, fname, data, exclusive=body.expected_exists is False)
        st = _stat(fd, fname)
        return {"ok": True, "name": fname, "size": st.st_size, "mtime": st.st_mtime}


@router.get("/context")
def list_context(project: str = Query(...)) -> dict:
    root = _project_root(_load_project(project))
    files = []
    try:
        with _directory(root, context=True) as fd:
            with os.scandir(fd) as entries:
                for entry in entries:
                    if entry.name.startswith(".") or not entry.is_file(follow_symlinks=False):
                        continue
                    st = entry.stat(follow_symlinks=False)
                    files.append({"name": entry.name, "size": st.st_size, "mtime": st.st_mtime, "text": Path(entry.name).suffix.lower() in _TEXT_EXTS})
                    if len(files) >= MAX_CONTEXT_ENTRIES:
                        break
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        return {"dir": str(root / CONTEXT_DIR), "exists": False, "files": []}
    files.sort(key=lambda f: f["name"].lower())
    return {"dir": str(root / CONTEXT_DIR), "exists": True, "files": files}


@router.get("/context/file")
def read_context(project: str = Query(...), name: str = Query(...)) -> dict:
    root = _project_root(_load_project(project))
    fname = _check_segment(name)
    with _directory(root, context=True) as fd:
        result = _read_text(fd, fname)
        if not result["exists"]:
            raise HTTPException(404, "file not found")
        return {"name": fname, **result}


class NoteBody(BaseModel):
    project: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    body: str = Field(default="", max_length=MAX_TEXT_BYTES)


def _create_unique(fd: int, stem: str, suffix: str, data: bytes) -> str:
    for i in range(1, 1000):
        name = f"{stem}{suffix}" if i == 1 else f"{stem}-{i}{suffix}"
        try:
            _atomic_write(fd, name, data, exclusive=True)
            return name
        except HTTPException as exc:
            if exc.status_code not in (400, 409):
                raise
    raise HTTPException(409, "too many files with that name")


@router.post("/context")
def add_context_note(body: NoteBody) -> dict:
    root = _project_root(_load_project(body.project))
    title = " ".join(body.title.split())
    text = body.body if body.body.lstrip().startswith("#") else f"# {title}\n\n{body.body}"
    if not text.endswith("\n"):
        text += "\n"
    data = text.encode("utf-8")
    if len(data) > MAX_TEXT_BYTES:
        raise HTTPException(413, "content too large")
    with _directory(root, context=True, create=True) as fd:
        name = _create_unique(fd, slugify(title), ".md", data)
    return {"ok": True, "name": name, "size": len(data)}


@router.post("/context/upload")
async def upload_context(request: Request, project: str = Query(...)) -> dict:
    root = _project_root(_load_project(project))
    # Consume a strictly bounded body before multipart parsing, regardless of Content-Length.
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "request too large (10 MiB max)")
        chunks.append(chunk)
    request._body = b"".join(chunks)
    form = await request.form()
    try:
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(400, "multipart field 'file' is required")
        raw_name = os.path.basename(str(getattr(upload, "filename", "") or "upload"))
        stem, suffix = os.path.splitext(raw_name)
        safe_stem = re.sub(r"[^A-Za-z0-9._ -]+", "-", stem).strip(" .-") or "upload"
        safe_suffix = re.sub(r"[^A-Za-z0-9.]+", "", suffix)[:12]
        _check_segment(safe_stem + safe_suffix)
        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        with _directory(root, context=True, create=True) as fd:
            name = _create_unique(fd, safe_stem, safe_suffix, data)
        return {"ok": True, "name": name, "size": len(data)}
    finally:
        await form.close()


class FolderBody(BaseModel):
    name: str = Field(default="", max_length=MAX_TITLE)
    path: str = Field(default="", max_length=4096)


def _refuse_special(path: Path) -> None:
    home = Path.home().resolve()
    hermes = _hermes_home().resolve()
    if path in {Path("/"), home, home.parent} or _inside(hermes, path) or _inside(path, hermes):
        raise HTTPException(400, "that folder cannot be a project folder")


@router.post("/folder")
def prepare_folder(body: FolderBody) -> dict:
    """Resolve the folder for a new project. An explicit ``path`` must already exist; without one,
    ``~/projects/<slug>`` is created (only that one level, never elsewhere)."""
    if body.path.strip():
        raw = body.path.strip()
        if not os.path.isabs(raw) or "\x00" in raw:
            raise HTTPException(400, "folder path must be absolute")
        path = Path(raw).resolve()
        _refuse_special(path)
        if not path.is_dir():
            raise HTTPException(404, "folder does not exist")
        return {"path": str(path), "created": False}
    if not body.name.strip():
        raise HTTPException(400, "name or path is required")
    root = _projects_root()
    root.mkdir(mode=0o755, exist_ok=True)
    root = root.resolve()
    path = confined(root, slugify(body.name))
    _refuse_special(path.resolve())
    created = not path.exists()
    if path.is_symlink():
        raise HTTPException(409, "folder is a symlink")
    path.mkdir(mode=0o755, exist_ok=True)
    return {"path": str(path.resolve()), "created": created}


class ScaffoldBody(BaseModel):
    project: str = Field(min_length=1, max_length=128)


@router.post("/scaffold")
def scaffold(body: ScaffoldBody) -> dict:
    """Create AGENTS.md / MEMORY.md / context/ when missing. Never overwrites a file, and skips
    AGENTS.md when another instructions file Hermes prefers is already there."""
    proj = _load_project(body.project)
    root = _project_root(proj)
    texts = scaffold_texts(proj.name, proj.description or "")
    created = []
    with _directory(root) as fd:
        effective = _effective_instructions(fd)
        has_instructions = bool(_read_text(fd, effective)["content"].strip())
        if not has_instructions and _write_if_missing(fd, "AGENTS.md", texts["AGENTS.md"]):
            created.append("AGENTS.md")
        if _write_if_missing(fd, NOTES_FILE, texts[NOTES_FILE]):
            created.append(NOTES_FILE)
        if _write_if_missing(fd, MEMORY_FILE, texts["MEMORY.md"]):
            created.append(MEMORY_FILE)
        try:
            os.mkdir(CONTEXT_DIR, 0o755, dir_fd=fd)
            created.append("context/")
        except FileExistsError:
            pass
    with _directory(root, context=True) as fd:
        if not os.listdir(fd) and _write_if_missing(fd, "README.md", texts["context/README.md"]):
            created.append("context/README.md")
    return {"ok": True, "created": created}


_NOTES_MARKER = "<!-- project-home:notes-awareness -->"
_NOTES_BLOCK = (_NOTES_MARKER + "\nRead PROJECT_NOTES.md as user-authored high-level direction, "
                "not formal working instructions or an exhaustive plan. Do not rewrite it without a user request.\n")


@router.post("/notes/enable")
def enable_notes(body: ScaffoldBody) -> dict:
    root = _project_root(_load_project(body.project))
    sources = _ancestor_instructions(root)
    if sources and Path(sources[0]).name in (".hermes.md", "HERMES.md"):
        raise HTTPException(409, "ancestor Hermes instructions take precedence; update them manually")
    with _directory(root) as fd:
        name = _effective_instructions(fd)
        old = _read_text(fd, name)
        if _NOTES_MARKER in old["content"]:
            return {"ok": True, "name": name, "changed": False}
        if old["exists"] and "\ufffd" in old["content"]:
            raise HTTPException(409, "instruction file is not valid UTF-8")
        data = (old["content"] + ("" if old["content"].endswith("\n\n") else "\n" if old["content"].endswith("\n") else "\n\n") if old["content"] else "") + _NOTES_BLOCK
        _atomic_write(fd, name, data.encode("utf-8"), exclusive=not old["exists"])
        return {"ok": True, "name": name, "changed": True}


@router.get("/pins")
def pins(ids: str = Query("", max_length=20000)) -> dict:
    """Durable pin flags (``sessions.pinned`` in state.db) for the given session ids. Read-only."""
    wanted = [i for i in dict.fromkeys(s.strip() for s in ids.split(",")) if i and len(i) <= 128][:500]
    if not wanted:
        return {"pinned": {}}
    db = _hermes_home() / "state.db"
    if not db.is_file():
        return {"pinned": {}}
    marks = ",".join("?" * len(wanted))
    try:
        with closing(sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)) as conn:
            rows = conn.execute(f"SELECT id, COALESCE(pinned, 0) FROM sessions WHERE id IN ({marks})", wanted).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(503, f"session store unavailable: {exc}")
    return {"pinned": {sid: bool(flag) for sid, flag in rows}}


class CronBody(BaseModel):
    project: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=MAX_TITLE)
    schedule: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=MAX_CRON_FIELD)


@router.post("/cron")
def add_cron(body: CronBody) -> dict:
    """Create a cron job whose workdir is the project folder (``cron.manage add`` has no workdir).

    Uses the same ``cronjob`` tool function the gateway's ``cron.manage`` calls, so validation and
    scheduler registration are Hermes' own."""
    proj = _load_project(body.project)
    root = _project_root(proj)
    if not root.is_dir():
        raise HTTPException(409, "project folder does not exist")
    import json

    from tools.cronjob_tools import cronjob

    raw = cronjob(action="create", name=" ".join(body.name.split()), schedule=body.schedule.strip(),
                  prompt=body.prompt, workdir=str(root))
    try:
        result = json.loads(raw)
    except (TypeError, ValueError):
        raise HTTPException(500, "unexpected cron response")
    if result.get("success") is False or result.get("error"):
        raise HTTPException(400, str(result.get("error") or "could not create the job"))
    return result
