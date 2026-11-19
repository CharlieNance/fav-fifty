"""add analytics_events and analytics_daily

Revision ID: 9a3e6b2d4f17
Revises: 7c1d5e9f2a40
Create Date: 2026-11-18 12:00:00.000000+00:00

Additive: two new tables for first-party analytics events; nothing existing changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a3e6b2d4f17"
down_revision: str | None = "7c1d5e9f2a40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "analytics_events",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("platform", sa.String(length=8), nullable=False),
        sa.Column("app_version", sa.String(length=32), nullable=False),
        sa.Column(
            "props",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_analytics_events_occurred_at"), "analytics_events", ["occurred_at"], unique=False
    )
    op.create_table(
        "analytics_daily",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("platform", sa.String(length=8), nullable=False),
        sa.Column("signed_in", sa.Boolean(), nullable=False),
        sa.Column("events", sa.Integer(), nullable=False),
        sa.Column("sessions", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("day", "name", "platform", "signed_in"),
    )


def downgrade() -> None:
    op.drop_table("analytics_daily")
    op.drop_index(op.f("ix_analytics_events_occurred_at"), table_name="analytics_events")
    op.drop_table("analytics_events")
