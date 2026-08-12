import re

from fastapi import APIRouter, Request, HTTPException
from datetime import datetime
from models import ResponseSubmit, ResponseRecord, ParticipantUpdate, SelfRegisterRequest
from services.db import get_db
from services.token_service import generate_token
from config import get_settings

router = APIRouter(prefix="/api", tags=["responses"])

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


async def _participant_payload(db, participant: dict) -> dict:
    token = participant["token"]
    existing = await db.responses.find_one({"token": token}, {"_id": 0})
    return {
        "token": token,
        "name": participant.get("name", ""),
        "email": participant.get("email", ""),
        "org": participant.get("org", ""),
        "position": participant.get("position", ""),
        "category": participant.get("category", ""),
        "field": participant.get("field", ""),
        "phone": participant.get("phone", ""),
        "source": participant.get("source", "import"),
        "has_responded": existing is not None,
        "responses": existing.get("responses") if existing else None,
        "submitted_at": existing.get("submitted_at").isoformat() if existing and existing.get("submitted_at") else None,
        "updated_at": existing.get("updated_at").isoformat() if existing and existing.get("updated_at") else None,
    }


@router.post("/register")
async def self_register(body: SelfRegisterRequest):
    """공개 링크 응답자의 자기등록. 같은 이메일이면 기존 참가자·응답을 이어받는다."""
    name = body.name.strip()
    org = body.org.strip()
    email = body.email.strip().lower()

    if not name:
        raise HTTPException(400, "이름을 입력해 주십시오.")
    if not org:
        raise HTTPException(400, "소속을 입력해 주십시오.")
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "올바른 이메일을 입력해 주십시오.")
    if not body.consent:
        raise HTTPException(400, "개인정보 수집·이용에 동의해 주셔야 참여하실 수 있습니다.")

    db = get_db()
    token = generate_token(email, get_settings().TOKEN_SECRET)
    now = datetime.utcnow()

    fields = {
        "name": name,
        "org": org,
        "email": email,
        "position": body.position.strip(),
        "phone": body.phone.strip(),
        "updated_at": now,
    }

    existing = await db.participants.find_one({"token": token})
    if existing:
        # 최초 동의 시점은 덮어쓰지 않는다.
        if not existing.get("consent_at"):
            fields["consent"] = True
            fields["consent_at"] = now
        await db.participants.update_one({"token": token}, {"$set": fields})
    else:
        await db.participants.insert_one({
            "token": token,
            **fields,
            "consent": True,
            "consent_at": now,
            "category": "",
            "field": "",
            "source": "self",
            "created_at": now,
        })

    participant = await db.participants.find_one({"token": token}, {"_id": 0})
    payload = await _participant_payload(db, participant)
    payload["registered"] = "existing" if existing else "created"
    return payload


@router.get("/survey/{token}")
async def verify_token(token: str):
    db = get_db()
    participant = await db.participants.find_one({"token": token}, {"_id": 0})
    if not participant:
        raise HTTPException(404, "유효하지 않은 설문 링크입니다.")

    return await _participant_payload(db, participant)


@router.patch("/survey/{token}/participant")
async def update_participant(token: str, body: ParticipantUpdate, request: Request):
    db = get_db()
    current = await db.participants.find_one({"token": token})
    if not current:
        raise HTTPException(404, "유효하지 않은 토큰입니다.")

    update_fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not update_fields:
        raise HTTPException(400, "수정할 필드가 없습니다.")

    if "email" in update_fields and update_fields["email"] != current.get("email"):
        # 자기등록 참가자의 토큰은 이메일에서 파생되므로, 이메일을 바꾸면
        # 다른 기기에서 재접속할 때 응답을 찾지 못한다.
        if current.get("source") == "self":
            raise HTTPException(
                400,
                "이메일은 응답 식별자로 사용되어 변경할 수 없습니다. "
                "변경이 필요하시면 연구진에 문의해 주십시오.",
            )
        clash = await db.participants.find_one({
            "email": update_fields["email"],
            "token": {"$ne": token},
        })
        if clash:
            raise HTTPException(409, "이미 사용 중인 이메일입니다.")

    now = datetime.utcnow()
    last_backup = await db.participants_backup.find_one(
        {"token": token}, sort=[("version", -1)]
    )
    next_version = (last_backup.get("version", 0) + 1) if last_backup else 1

    snapshot = {k: v for k, v in current.items() if k != "_id"}
    await db.participants_backup.insert_one({
        "token": token,
        "version": next_version,
        "backed_up_at": now,
        "ip": request.client.host if request.client else "",
        "user_agent": request.headers.get("user-agent", ""),
        "snapshot": snapshot,
    })

    update_fields["updated_at"] = now
    await db.participants.update_one({"token": token}, {"$set": update_fields})

    updated = await db.participants.find_one({"token": token}, {"_id": 0})
    return {
        "status": "updated",
        "backup_version": next_version,
        "participant": {
            "token": updated["token"],
            "name": updated.get("name", ""),
            "email": updated.get("email", ""),
            "org": updated.get("org", ""),
            "position": updated.get("position", ""),
            "phone": updated.get("phone", ""),
            "category": updated.get("category", ""),
        },
    }


@router.post("/responses")
async def submit_response(body: ResponseSubmit, request: Request):
    db = get_db()
    participant = await db.participants.find_one({"token": body.token})
    if not participant:
        raise HTTPException(404, "유효하지 않은 토큰입니다.")

    now = datetime.utcnow()
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")

    existing = await db.responses.find_one({"token": body.token})
    if existing:
        await db.responses.update_one(
            {"token": body.token},
            {"$set": {
                "responses": body.responses,
                "survey_version": body.survey_version,
                "updated_at": now,
                "ip": ip,
                "user_agent": ua,
            }},
        )
        return {"status": "updated", "token": body.token}

    record = ResponseRecord(
        token=body.token,
        survey_version=body.survey_version,
        responses=body.responses,
        submitted_at=now,
        ip=ip,
        user_agent=ua,
    )
    await db.responses.insert_one(record.model_dump())
    return {"status": "created", "token": body.token}


@router.get("/responses/{token}")
async def get_response(token: str):
    db = get_db()
    doc = await db.responses.find_one({"token": token}, {"_id": 0})
    if not doc:
        return {"token": token, "responses": None}
    return doc
