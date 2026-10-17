from sqlalchemy import event
from sqlmodel import SQLModel, Session, create_engine

sqlite_file_name = "energy_simulation.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

# check_same_thread: False allows background worker & REST threads to share the engine
connect_args = {"check_same_thread": False}
engine = create_engine(
    sqlite_url,
    echo=False,
    connect_args=connect_args,
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """
    Enables SQLite WAL (Write-Ahead Logging) mode and busy timeouts
    to ensure zero lock contention between background telemetry ingestion and concurrent REST API reads.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.execute("PRAGMA busy_timeout=5000;")
    cursor.close()


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
