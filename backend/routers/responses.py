import re

from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from datetime import datetime
from models import ResponseSubmit, ResponseRecord, ParticipantUpdate, SelfRegisterRequest
from services.db import get_db
from services.token_service import generate_token
from services.email_service import send_email
from config import get_settings

router = APIRouter(prefix="/api", tags=["responses"])

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# 2026.8.21. 제1차 조사 마감 — 신규 자기등록만 차단한다.
# 이미 설문을 열어 둔 응답자의 제출(/responses)은 작성분 유실 방지를 위해 허용.
SURVEY_CLOSED = True
SURVEY_CLOSED_MSG = (
    "본 전문가 조사는 2026년 8월 21일자로 마감되었습니다. "
    "참여해 주신 전문가 여러분께 깊이 감사드립니다. 문의: jklee@auri.re.kr"
)

# 응답 수 도달 시 연구책임자에게 알림 메일. milestone_states 컬렉션으로 중복 발송 차단.
MILESTONES = [15, 20, 25, 30]
MILESTONE_TO = "jklee@auri.re.kr"


async def _notify_milestones():
    db = get_db()
    test_tokens = [
        p["token"]
        async for p in db.participants.find({"is_test": True}, {"token": 1})
    ]
    count = await db.responses.count_documents({"token": {"$nin": test_tokens}})
    for m in MILESTONES:
        if count < m:
            continue
        res = await db.milestone_states.update_one(
            {"milestone": m},
            {"$setOnInsert": {
                "milestone": m,
                "count_at_send": count,
                "sent_at": datetime.utcnow(),
            }},
            upsert=True,
        )
        if not res.upserted_id:
            continue  # 이미 발송된 마일스톤
        html = (
            "<p>복합용도 전문가 설문(complex-use-survey) 응답이 "
            f"<strong>{m}명</strong>에 도달했습니다.</p>"
            f"<p>현재 제출 응답: {count}명 (테스트 계정 제외)</p>"
            "<p>관리자 대시보드: "
            '<a href="https://burn001.github.io/complex-use-survey/admin/">'
            "https://burn001.github.io/complex-use-survey/admin/</a></p>"
        )
        try:
            send_email(
                MILESTONE_TO,
                f"[복합용도 설문] 응답 {m}명 도달 (현재 {count}명)",
                html,
            )
        except Exception:
            # 발송 실패 시 상태를 되돌려 다음 제출 때 재시도
            await db.milestone_states.delete_one({"milestone": m})


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
    if SURVEY_CLOSED:
        raise HTTPException(410, SURVEY_CLOSED_MSG)
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
async def submit_response(body: ResponseSubmit, request: Request, background_tasks: BackgroundTasks):
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
    background_tasks.add_task(_notify_milestones)
    return {"status": "created", "token": body.token}


@router.get("/responses/{token}")
async def get_response(token: str):
    db = get_db()
    doc = await db.responses.find_one({"token": token}, {"_id": 0})
    if not doc:
        return {"token": token, "responses": None}
    return doc
