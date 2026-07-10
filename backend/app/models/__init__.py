"""SQLAlchemy ORM models — the database tables.

Importing this package registers every model on ``Base.metadata`` so tools like
Alembic autogenerate see the complete schema. Import models from here, e.g.::

    from app.models import User, List
"""

from app.db.base import Base
from app.models.list import List
from app.models.list_item import ListItem
from app.models.tag import Tag, list_tags
from app.models.user import User

__all__ = ["Base", "User", "List", "ListItem", "Tag", "list_tags"]
