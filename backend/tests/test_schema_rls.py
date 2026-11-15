"""The SQL schema keeps its own copy of the ownership rule — check it does.

db.py filters every query by user_id, and RLS is the second lock. A new table
added without `enable row level security` is a silent hole, so the schema file
itself is asserted here: it is cheap, and it cannot drift quietly.
"""
from __future__ import annotations

import re
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[1] / "schema.sql"

# Tables whose rows belong to one account and must be owner-scoped.
USER_TABLES = ("transactions", "documents", "risk_settings", "profiles")

# Tables that are deliberately readable by everyone (and only writable by the
# service role). Keep this list short and justified.
PUBLIC_READ_TABLES = ("market_snapshot",)


def _sql() -> str:
    return re.sub(r"--[^\n]*", "", SCHEMA.read_text(encoding="utf-8")).lower()


def test_every_table_in_the_schema_has_rls_enabled():
    created = set(re.findall(r"create table if not exists (\w+)", _sql()))
    assert created, "schema.sql should create tables"
    for table in sorted(created):
        assert re.search(rf"alter table {table}\s+enable row level security", _sql()), \
            f"{table} is missing RLS"


def test_every_user_table_has_an_owner_policy_for_each_operation():
    sql = _sql()
    for table in USER_TABLES:
        for operation in ("select", "insert", "update", "delete"):
            # profiles is read/updated through the app, never inserted by a user.
            if table == "profiles" and operation in ("insert", "delete"):
                continue
            pattern = rf"create policy \"[^\"]*\" on {table} for {operation}"
            assert re.search(pattern, sql), f"{table} has no {operation} policy"
        assert "auth.uid()" in sql


def test_the_public_table_is_read_only_for_clients():
    sql = _sql()
    for table in PUBLIC_READ_TABLES:
        policies = re.findall(rf"create policy \"[^\"]*\" on {table} for (\w+)", sql)
        assert policies, f"{table} has no policy at all"
        assert set(policies) <= {"select"}, f"{table} must not be client-writable"


def test_ownership_columns_cascade_when_an_account_is_deleted():
    sql = _sql()
    for table in USER_TABLES:
        block = re.search(rf"create table if not exists {table} \((.*?)\n\);", sql, re.S)
        assert block, f"{table} definition not found"
        assert "on delete cascade" in block.group(1), f"{table} would outlive its account"
