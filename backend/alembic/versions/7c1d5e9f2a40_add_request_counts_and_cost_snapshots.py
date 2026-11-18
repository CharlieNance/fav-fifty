"""add request_counts and cost_snapshots

Revision ID: 7c1d5e9f2a40
Revises: 4e7b2c9a1d03
Create Date: 2026-11-18 00:00:00.000000+00:00

Additive: two new tables for the admin dashboard; nothing existing changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c1d5e9f2a40"
down_revision: str | None = "4e7b2c9a1d03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "request_counts",
        sa.Column("minute", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route_class", sa.String(length=16), nullable=False),
        sa.Column("status_class", sa.String(length=8), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("minute", "route_class", "status_class"),
    )
    op.create_table(
        "cost_snapshots",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "taken_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("month_to_date", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("forecast", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column(
            "by_service",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("cost_snapshots")
    op.drop_table("request_counts")
