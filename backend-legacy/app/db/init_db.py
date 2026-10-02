from sqlalchemy import inspect, text

from app.db.session import Base, engine
from app.models import models  # noqa: F401


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _add_missing_columns_for_sqlite()


def _add_missing_columns_for_sqlite() -> None:
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            existing = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                column_type = column.type.compile(dialect=engine.dialect)
                connection.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column_type}'))
