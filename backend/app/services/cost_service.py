"""Daily AWS cost snapshot from Cost Explorer (docs/ARCHITECTURE.md
§Dashboards, Cost panel).

Cost Explorer's API charges $0.01 per request, so this makes exactly ONE call per
run (month to date, grouped by service) and is meant to run once a day
(``python -m app.cli daily-jobs``, from cron on the box): about $0.30 a month. The
forecast is a straight-line projection computed here, not a second, paid call to
the forecast API.

Needs ``ce:GetCostAndUsage`` on the box's IAM user. Cost Explorer has one endpoint,
in us-east-1, whatever region the rest of the app runs in.
"""

import calendar
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.metrics import CostSnapshot

CENT = Decimal("0.01")


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def straight_line_forecast(month_to_date: Decimal, today: date) -> Decimal | None:
    """Spend so far, scaled to the whole month. None before a full day has passed."""
    days_done = today.day - 1  # Cost Explorer's month-to-date stops at yesterday.
    if days_done < 1:
        return None
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    return _cents(month_to_date / days_done * days_in_month)


def fetch_month_to_date(client: Any, today: date) -> tuple[Decimal, str, dict[str, str]]:
    """One ``GetCostAndUsage`` call: (total, currency, {service: amount}) so far this month."""
    start = today.replace(day=1)
    if today == start:
        return Decimal("0.00"), "USD", {}  # Nothing billed yet; don't pay for the call.
    response = client.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": today.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
    )
    total = Decimal("0")
    currency = "USD"
    by_service: dict[str, str] = {}
    for period in response["ResultsByTime"]:
        for group in period.get("Groups", []):
            cost = group["Metrics"]["UnblendedCost"]
            amount = Decimal(cost["Amount"])
            currency = cost.get("Unit", currency)
            total += amount
            if _cents(amount) != 0:
                by_service[group["Keys"][0]] = str(_cents(amount))
    return _cents(total), currency, by_service


def take_snapshot(db: Session, client: Any, today: date) -> CostSnapshot:
    total, currency, by_service = fetch_month_to_date(client, today)
    snapshot = CostSnapshot(
        month=today.replace(day=1),
        month_to_date=total,
        forecast=straight_line_forecast(total, today),
        currency=currency,
        by_service=by_service,
    )
    db.add(snapshot)
    db.commit()
    return snapshot


def latest_snapshot(db: Session) -> CostSnapshot | None:
    return db.scalar(select(CostSnapshot).order_by(CostSnapshot.taken_at.desc()).limit(1))


def cost_explorer_client() -> Any:
    import boto3  # Deferred, like the SSM client: only the daily job needs it.

    return boto3.client("ce", region_name="us-east-1")
