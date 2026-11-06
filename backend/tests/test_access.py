"""Who can see a project when accounts are on: owner always; org members only if shared; other orgs never."""
from hone import auth, main

ALICE = {"id": "a", "email": "a@x.co", "name": "A", "org_id": "org1", "role": "owner"}
BOB = {"id": "b", "email": "b@x.co", "name": "B", "org_id": "org1", "role": "member"}
EVE = {"id": "e", "email": "e@y.co", "name": "E", "org_id": "org2", "role": "owner"}


def sees(person, project, monkeypatch) -> bool:
    monkeypatch.setattr(auth, "ENABLED", True)
    t = main._me.set(person)
    try:
        return main._owns_doc(project)
    finally:
        main._me.reset(t)


def test_private_is_owner_only(monkeypatch):
    p = {"ownerId": "a", "orgId": "org1", "visibility": "private"}
    assert sees(ALICE, p, monkeypatch)
    assert not sees(BOB, p, monkeypatch)
    assert not sees(EVE, p, monkeypatch)


def test_org_shared_reaches_org_only(monkeypatch):
    p = {"ownerId": "a", "orgId": "org1", "visibility": "org"}
    assert sees(ALICE, p, monkeypatch)
    assert sees(BOB, p, monkeypatch)
    assert not sees(EVE, p, monkeypatch)


def test_unowned_and_signed_out_see_nothing(monkeypatch):
    assert not sees(ALICE, {"visibility": "org", "orgId": "org1"}, monkeypatch)
    assert not sees(None, {"ownerId": "a", "orgId": "org1", "visibility": "org"}, monkeypatch)


def test_new_projects_start_private(monkeypatch):
    t = main._me.set(ALICE)
    try:
        assert main._ownership() == {"ownerId": "a", "ownerName": "A", "orgId": "org1", "visibility": "private"}
    finally:
        main._me.reset(t)


def test_cors_preflight_is_not_blocked(monkeypatch):
    """A browser's preflight carries no sign-in; the access check must not answer it with 404."""
    from fastapi.testclient import TestClient

    from hone import store

    monkeypatch.setattr(auth, "ENABLED", True)
    store.put("project", "pf-1", {"id": "pf-1", "ownerId": "a", "orgId": "org1", "visibility": "private"}, "pf-1")
    r = TestClient(main.app).options("/api/v1/projects/pf-1", headers={
        "Origin": "http://localhost:3100", "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization"})
    assert r.status_code == 200
