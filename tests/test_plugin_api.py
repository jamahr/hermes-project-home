import importlib.util
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hermes_cli import projects_db

spec = importlib.util.spec_from_file_location('project_home_api', Path(__file__).parents[1] / 'dashboard/plugin_api.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

@pytest.fixture
def env(tmp_path, monkeypatch):
    home = tmp_path / 'hermes'
    home.mkdir()
    monkeypatch.setenv('HERMES_HOME', str(home))
    root = tmp_path / 'project'
    root.mkdir()
    with projects_db.connect_closing() as conn:
        projects_db.create_project(conn, name='Test', slug='test', primary_path=str(root))
    monkeypatch.setattr(api, '_projects_root', lambda: tmp_path / 'projects')
    app = FastAPI()
    app.include_router(api.router)
    with TestClient(app) as client:
        yield client, root, home, tmp_path

def test_routes(env, monkeypatch):
    c, root, home, tmp = env
    assert c.get('/health').json()['ok']
    assert c.get('/project', params={'project':'test'}).json()['root'] == str(root)
    assert c.get('/project', params={'project':'missing'}).status_code == 404
    assert c.post('/scaffold', json={'project':'test'}).status_code == 200
    assert c.post('/scaffold', json={'project':'test'}).json()['created'] == []
    assert c.get('/file', params={'project':'test','name':'AGENTS.md'}).json()['exists']
    assert c.put('/file', params={'project':'test','name':'MEMORY.md'}, json={'content':'hello'}).status_code == 200
    assert c.get('/file', params={'project':'test','name':'MEMORY.md'}).json()['content'] == 'hello'
    assert c.post('/context', json={'project':'test','title':'Notes','body':'hello'}).status_code == 200
    assert c.get('/context', params={'project':'test'}).status_code == 200
    assert c.get('/context/file', params={'project':'test','name':'notes.md'}).json()['content'].startswith('# Notes')
    assert c.post('/context/upload', params={'project':'test'}, files={'file':('a.txt',b'hi')}).status_code == 200
    assert c.post('/folder', json={'name':'A New Project'}).json()['created']
    assert c.post('/folder', json={'path':str(root)}).json()['created'] is False
    with sqlite3.connect(home / 'state.db') as db:
        db.execute('create table sessions (id text, pinned integer)')
        db.execute("insert into sessions values ('s1',1)")
    assert c.get('/pins', params={'ids':'s1'}).json() == {'pinned':{'s1':True}}
    import tools.cronjob_tools
    monkeypatch.setattr(tools.cronjob_tools, 'cronjob', lambda **kw: '{"success":true}')
    assert c.post('/cron', json={'project':'test','name':'task','schedule':'daily','prompt':'x'}).json()['success']

def test_confinement(env):
    c, root, home, tmp = env
    outside = tmp / 'outside'
    outside.mkdir()
    (outside / 'secret').write_text('secret')
    for name in ['../secret', '/etc/passwd', 'context/../secret']:
        assert c.get('/file', params={'project':'test','name':name}).status_code == 400
        assert c.get('/context/file', params={'project':'test','name':name}).status_code == 400
    (root / 'MEMORY.md').symlink_to(outside / 'secret')
    assert c.put('/file', params={'project':'test','name':'MEMORY.md'}, json={'content':'bad'}).status_code == 400
    assert c.get('/file', params={'project':'test','name':'MEMORY.md'}).status_code == 400
    (root / 'context').symlink_to(outside, target_is_directory=True)
    assert c.post('/context', json={'project':'test','title':'bad'}).status_code in (400,409)
    assert c.post('/scaffold', json={'project':'test'}).status_code in (400,409)
    assert (outside / 'secret').read_text() == 'secret'


def test_editor_rejects_invalid_utf8_without_modifying_file(env):
    c, root, _, _ = env
    memory = root / "MEMORY.md"
    original = b"memory\x80data"
    memory.write_bytes(original)

    response = c.get("/file", params={"project": "test", "name": "MEMORY.md"})

    assert response.status_code == 415
    assert "utf-8" in response.json()["detail"].lower()
    assert memory.read_bytes() == original


def test_editor_existence_conflicts(env):
    c, root, _, _ = env
    q = {"project": "test", "name": "MEMORY.md"}
    assert c.get("/file", params=q).json()["exists"] is False
    (root / "MEMORY.md").write_text("other")
    assert c.put("/file", params=q, json={"content": "mine", "expected_exists": False}).status_code == 409
    (root / "MEMORY.md").unlink()
    assert c.put("/file", params=q, json={"content": "mine", "expected_exists": True}).status_code == 409

def test_empty_instructions_and_variants(env):
    c, root, _, _ = env
    (root / ".hermes.md").write_text("")
    assert "AGENTS.md" in c.post("/scaffold", json={"project": "test"}).json()["created"]
    (root / "AGENTS.md").unlink()
    (root / "agents.md").write_text("hello")
    assert c.get("/project", params={"project": "test"}).json()["instructions_file"] == "agents.md"

def test_upload_body_limit(env, monkeypatch):
    c, root, _, _ = env
    monkeypatch.setattr(api, "MAX_UPLOAD_BYTES", 100)
    response = c.post("/context/upload", params={"project": "test"}, files={"file": ("a.txt", b"x" * 200)})
    assert response.status_code == 413
    assert not (root / "context").exists()


def test_project_notes_scaffold_and_enable(env):
    c, root, _, _ = env
    assert c.post("/scaffold", json={"project": "test"}).status_code == 200
    assert (root / "PROJECT_NOTES.md").read_text() == "# Project notes\n\n"
    instructions = (root / "AGENTS.md").read_text()
    assert "PROJECT_NOTES.md" in instructions
    q = {"project": "test", "name": "PROJECT_NOTES.md"}
    assert c.put("/file", params=q, json={"content": "direction", "expected_exists": True}).status_code == 200
    assert c.get("/file", params=q).json()["content"] == "direction"
    (root / "AGENTS.md").write_text("Existing instructions\n")
    assert c.post("/notes/enable", json={"project": "test"}).status_code == 200
    updated = (root / "AGENTS.md").read_text()
    assert updated.startswith("Existing instructions\n") and "PROJECT_NOTES.md" in updated
    assert c.post("/notes/enable", json={"project": "test"}).status_code == 200
    assert (root / "AGENTS.md").read_text() == updated


def test_context_swap_does_not_escape(env, monkeypatch):
    import os
    c, root, _, tmp = env
    context = root / "context"
    context.mkdir()
    outside = tmp / "outside"
    outside.mkdir()
    original = api._atomic_write
    def swap(fd, name, data, **kwargs):
        context.rename(root / "held")
        context.symlink_to(outside, target_is_directory=True)
        return original(fd, name, data, **kwargs)
    monkeypatch.setattr(api, "_atomic_write", swap)
    assert c.post("/context", json={"project": "test", "title": "test"}).status_code == 200
    assert not (outside / "test.md").exists()
    assert (root / "held" / "test.md").exists()

def test_upload_chunked_stops_before_parsing(env, monkeypatch):
    import asyncio
    from starlette.requests import Request
    c, root, _, _ = env
    monkeypatch.setattr(api, "MAX_UPLOAD_BYTES", 10)
    calls = []
    async def receive():
        calls.append(1)
        return {"type": "http.request", "body": b"x" * 6, "more_body": True}
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []}, receive)
    with pytest.raises(api.HTTPException) as exc:
        asyncio.run(api.upload_context(request, project="test"))
    assert exc.value.status_code == 413
    assert len(calls) == 2
    assert not (root / "context").exists()


def test_ancestor_sources_are_read_only(env):
    c, root, _, tmp = env
    (tmp / ".git").mkdir()
    ancestor = tmp / "AGENTS.md"
    ancestor.write_text("ancestor guidance")
    response = c.get("/project", params={"project": "test"}).json()
    assert response["ancestor_instruction_sources"] == [str(ancestor)]
    c.post("/scaffold", json={"project": "test"})
    assert ancestor.read_text() == "ancestor guidance"

def test_empty_hermes_hides_other_hermes_name(env):
    c, root, _, _ = env
    (root / ".hermes.md").write_text("")
    (root / "HERMES.md").write_text("ignored")
    assert "AGENTS.md" in c.post("/scaffold", json={"project": "test"}).json()["created"]
    assert c.get("/project", params={"project": "test"}).json()["instructions_file"] == "AGENTS.md"
