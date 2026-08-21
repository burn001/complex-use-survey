from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from config import get_settings

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None

# 조사 라운드 응답 컬렉션. R2(v8-r2)부터 responses_r2 에 저장하며
# R1 원자료(responses)는 읽기 전용으로 보존한다. R3 전환 시 이 값만 교체.
RESPONSES_COLL = "responses_r2"


async def connect():
    global _client, _db
    s = get_settings()
    _client = AsyncIOMotorClient(
        s.MONGODB_URI,
        maxPoolSize=50,
        minPoolSize=2,
        maxIdleTimeMS=300_000,
        serverSelectionTimeoutMS=5_000,
    )
    _db = _client[s.MONGODB_DB]
    await _db.participants.create_index("token", unique=True)
    await _db.participants.create_index("email", unique=True)
    await _db.responses.create_index("token")
    await _db[RESPONSES_COLL].create_index("token")
    await _db.participants_backup.create_index("token")
    await _db.participants_backup.create_index([("token", 1), ("version", -1)])


async def disconnect():
    global _client
    if _client:
        _client.close()


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not connected")
    return _db
