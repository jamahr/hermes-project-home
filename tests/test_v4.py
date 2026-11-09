from test_plugin_api import env, api
import pytest


def upload(c, path, content=b'hello', policy='rename'):
    return c.post('/context/upload', params={'project': 'test', 'path': path, 'on_conflict': policy}, files={'file': ('a.txt', content)})


def test_nested_upload(env):
    c, root, _, _ = env
    r = upload(c, 'folder/sub/a.txt')
    assert r.status_code == 200
    assert r.json()['path'] == 'folder/sub/a.txt'
    assert (root / 'context/folder/sub/a.txt').read_bytes() == b'hello'
    assert c.get('/context/file', params={'project': 'test', 'path': 'folder/sub/a.txt'}).json()['content'] == 'hello'


@pytest.mark.parametrize('path', ['../x', '/etc/x', 'a/../../x', '.', 'a//x', 'a/\nx', 'a/.hidden', 'x/' + 'a' * 121, '/'.join(['a'] * 9), 'a' * 100 + '/' + 'b' * 100 + '/' + 'c' * 100 + '/' + 'd' * 100 + '/' + 'e' * 100 + '/12345678'])
def test_bad_paths(env, path):
    c, root, _, _ = env
    assert upload(c, path).status_code == 400
    assert not (root / 'context').exists()


def test_symlink_intermediate(env):
    c, root, _, tmp = env
    (root / 'context').mkdir()
    outside = tmp / 'outside'
    outside.mkdir()
    (root / 'context/link').symlink_to(outside, target_is_directory=True)
    assert upload(c, 'link/a.txt').status_code in (400, 409)
    assert not list(outside.iterdir())


def test_conflict_policies(env):
    c, root, _, _ = env
    assert upload(c, 'dir/a.txt', b'one').json()['status'] == 'created'
    result = upload(c, 'dir/a.txt', b'two').json()
    assert result['status'] == 'renamed' and result['path'] == 'dir/a-2.txt'
    assert upload(c, 'dir/a.txt', b'three', 'skip').json()['status'] == 'skipped'
    assert (root / 'context/dir/a.txt').read_bytes() == b'one'
    assert upload(c, 'dir/a.txt', b'four', 'overwrite').json()['status'] == 'overwritten'
    assert (root / 'context/dir/a.txt').read_bytes() == b'four'
    assert upload(c, 'dir/a.txt', policy='bad').status_code == 422


def test_recursive_list_and_truncation(env, monkeypatch):
    c, root, _, tmp = env
    assert upload(c, 'folder/a.txt').status_code == 200
    assert upload(c, 'folder/b.txt').status_code == 200
    assert upload(c, 'root.txt').status_code == 200
    (root / 'context/folder/link').symlink_to(tmp, target_is_directory=True)
    listed = c.get('/context', params={'project': 'test'}).json()
    assert {f['path'] for f in listed['files']} == {'folder/a.txt', 'folder/b.txt', 'root.txt'}
    assert all(f['name'] == f['path'].split('/')[-1] for f in listed['files'])
    assert listed['truncated'] is False
    monkeypatch.setattr(api, 'MAX_CONTEXT_ENTRIES', 2)
    listed = c.get('/context', params={'project': 'test'}).json()
    assert len(listed['files']) == 2 and listed['truncated'] is True


def test_exact_upload_limit(env):
    c, root, _, _ = env
    response = upload(c, 'limit.bin', b'x' * api.MAX_UPLOAD_BYTES)
    assert response.status_code == 200
    assert (root / 'context/limit.bin').stat().st_size == api.MAX_UPLOAD_BYTES
    assert upload(c, 'too-large.bin', b'x' * (api.MAX_UPLOAD_BYTES + 1)).status_code == 413
