from hone.ingest import Mapping, group, guess_mapping, normalise_role, read_csv, redact, split, sufficiency

CSV = b"""conversation_id,customer_id,sender,message,created_at
c1,u1,customer,Hi my name is Anna Rossi,2026-01-01T10:00:00Z
c1,u1,bot,Hello! How can I help?,2026-01-01T10:00:05Z
c2,u2,customer,Call me on +39 333 123 4567,2026-01-01T11:00:00Z
"""


def test_guess_and_group():
    cols, rows = read_csv(CSV)
    m = guess_mapping(cols, rows)
    assert (m.group_by, m.group_kind, m.role, m.content, m.created_at) == (
        "conversation_id", "conversation", "sender", "message", "created_at")
    convs = group(rows, m)
    assert len(convs) == 2
    first = next(c for c in convs if len(c.messages) == 2)
    assert [x["role"] for x in first.messages] == ["user", "agent"]
    assert "Anna" not in first.messages[0]["content"]


def test_customer_grouping():
    _cols, rows = read_csv(CSV)
    convs = group(rows, Mapping("customer_id", "customer", "sender", "message"))
    assert len(convs) == 2


def test_redact():
    out = redact("Email me at a.b@example.com or +1 (415) 555-0100, SSN 123-45-6789")
    assert "example.com" not in out and "555" not in out and "6789" not in out


def test_roles():
    assert normalise_role("Assistant") == "agent" and normalise_role("customer") == "user"


def test_split_is_stable():
    ids = [f"id{i}" for i in range(500)]
    dev, test = split(ids)
    assert split(ids) == (dev, test) and 70 < len(test) < 130


def test_sufficiency():
    s = sufficiency([])
    assert s.decision == "mostly_generated" and s.generate == 100 and s.test == 20
