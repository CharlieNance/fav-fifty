"""add ip_request_counts

Hourly per-IP request and 429 counts for the admin abuse view
(docs/ARCHITECTURE.md §Abuse view), kept 7 days.

Revision ID: b4e8c1d7a2f3
Revises: 9a3e6b2d4f17
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b4e8c1d7a2f3"
down_revision: str | None = "9a3e6b2d4f17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ip_request_counts",
        sa.Column("hour", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False),
        sa.Column("rate_limited", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("hour", "ip"),
    )


def downgrade() -> None:
    op.drop_table("ip_request_counts")
