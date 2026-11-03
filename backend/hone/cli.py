"""`hone gate` for CI: run the held-out test through the API, wait, apply the gate, exit 1 if blocked."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import httpx


def main() -> None:
    ap = argparse.ArgumentParser(prog="hone")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gate", help="Run the held-out test and fail if the agent got worse")
    g.add_argument("--project", required=True)
    g.add_argument("--split", default="test", choices=["dev", "test"])
    g.add_argument("--budget", type=float, default=None, help="Spend cap in USD (default: project's)")
    g.add_argument("--min-pass-k", type=float, default=None)
    g.add_argument("--max-regression", type=float, default=None)
    g.add_argument("--require-trusted", action="store_true")
    a = ap.parse_args()

    base = os.environ.get("HONE_API_URL", "http://localhost:8000").rstrip("/") + "/api/v1"
    with httpx.Client(timeout=60) as c:
        project = c.get(f"{base}/projects/{a.project}").raise_for_status().json()
        if a.min_pass_k is not None or a.max_regression is not None or a.require_trusted:
            gate = c.get(f"{base}/projects/{a.project}/gate").json()
            c.put(f"{base}/projects/{a.project}/gate", json={
                "minPassK": a.min_pass_k if a.min_pass_k is not None else gate["minPassK"],
                "maxRegression": a.max_regression if a.max_regression is not None else gate["maxRegression"],
                "requireTrusted": a.require_trusted or gate["requireTrusted"],
            }).raise_for_status()
        dataset_size = 10_000  # the runner trims to what exists in the split
        run = c.post(f"{base}/projects/{a.project}/runs", json={
            "scenarios": dataset_size, "k": 3, "budgetUsd": a.budget or project["budgetUsd"], "split": a.split,
        }).raise_for_status().json()
        print(f"hone: started {run['id']} on {a.split}")
        while True:
            r = c.get(f"{base}/runs/{run['id']}").json()
            if r["status"] in ("done", "stopped"):
                break
            print(f"  {len(r['items'])} scenarios, ${r['costUsd']:.2f}", flush=True)
            time.sleep(5)
        verdict = c.post(f"{base}/projects/{a.project}/gate/check", params={"run_id": run["id"]}).json()
    print(json.dumps({"passK": r["passK"], "pass1": r["pass1"], "costUsd": r["costUsd"], **verdict}, indent=2))
    sys.exit(0 if verdict["passed"] else 1)


if __name__ == "__main__":
    main()
