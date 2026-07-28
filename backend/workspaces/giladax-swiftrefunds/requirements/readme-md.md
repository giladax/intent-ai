---
reference: README.md
version: onboard-1
status: approved
---

# SwiftRefunds

Refund-decision service for e-commerce platforms. Takes a refund request, evaluates it against customer tier and risk profile, and returns an approval, denial, or pending-review outcome.

## What it does

- Auto-approves within-limit requests for standard and premium customers
- Routes high-risk accounts and over-limit requests to human review
- Logs every decision with a reason
- Exposes a small HTTP API (FastAPI)

The behavioral contract is in [PRODUCT.md](PRODUCT.md).

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn swiftrefunds.api:app --reload
```

## Test

```bash
pytest
```

## Structure

```
swiftrefunds/
  policy.py      — tier limits and risk thresholds (single source of truth)
  guard.py       — enforcement layer (reads policy, never hard-codes thresholds)
  decisions.py   — decision logging and denial-reason formatting
  api.py         — FastAPI HTTP layer
tests/
  test_policy.py
  test_guard.py
  test_decisions.py
  test_api.py
```
