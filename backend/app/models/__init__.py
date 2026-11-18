"""SQLAlchemy ORM models — the database tables.

Importing this package registers every model on ``Base.metadata`` so tools like
Alembic autogenerate see the complete schema. Import models from here, e.g.::

    from app.models import User, List
"""

from app.db.base import Base
from app.models.admin_audit_log import AdminAuditLog
from app.models.list import List
from app.models.list_item import ListItem
from app.models.metrics import CostSnapshot, RequestCount
from app.models.tag import Tag, list_tags
from app.models.user import User

__all__ = [
    "Base",
    "AdminAuditLog",
    "User",
    "List",
    "ListItem",
    "CostSnapshot",
    "RequestCount",
    "Tag",
    "list_tags",
]
