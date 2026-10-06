from django.db import transaction
from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import CooldownRule, Pit, User, Yard
from pits.rules import (
    STATUS_LABELS,
    RuleError,
    assert_can_set_status,
    cooldown_minutes,
    cooldown_remaining_seconds,
    latest_ph,
)

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


class CooldownIn(Schema):
    minutes: int


def cooldown_json(pit: Pit) -> dict:
    remaining = cooldown_remaining_seconds(pit)
    return {
        "minutes": cooldown_minutes(pit.status),
        "remainingSeconds": remaining,
        "ready": remaining == 0,
    }


def pit_json(pit: Pit) -> dict:
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
        "statusChangedAt": pit.status_changed_at.isoformat(),
        "cooldown": cooldown_json(pit),
    }


@api.post("/auth/login")
def login(request, payload: LoginIn):
    user = User.objects.filter(username=payload.username).first()
    if user is None or not user.check_password(payload.password):
        raise HttpError(401, "用户名或密码错误")
    return {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}


@api.get("/auth/me", auth=auth)
def me(request):
    user = request.auth
    return {"username": user.username, "role": user.role}


@api.get("/health")
def health(request):
    return {"status": "ok", "service": "TanPit"}


@api.get("/board", auth=auth)
def board(request):
    yard = Yard.objects.prefetch_related("pits__samples").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p) for p in pits]}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    # 酸碱登记不读沙漏：冷却期内也照常登记
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    pit.samples.create(ph=payload.ph, operator=request.auth.username)
    pit.refresh_from_db()
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    # 行锁 + 事务：两人抢着再拨时，检查与落库之间插不进第二笔
    with transaction.atomic():
        pit = Pit.objects.select_for_update().filter(id=pit_id).first()
        if pit is None:
            raise HttpError(404, "坑不存在")
        try:
            assert_can_set_status(pit, payload.status)
        except RuleError as exc:
            raise HttpError(400, str(exc))
        pit.status = payload.status
        pit.status_changed_at = timezone.now()
        pit.save(update_fields=["status", "status_changed_at"])
    return pit_json(pit)


@api.get("/cooldowns", auth=auth)
def list_cooldowns(request):
    rules = {r.status: r.minutes for r in CooldownRule.objects.all()}
    order = (Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED)
    items = [{"status": s, "label": STATUS_LABELS[s], "minutes": rules.get(s, 0)} for s in order]
    yard = Yard.objects.prefetch_related("pits").first()
    pits = []
    if yard is not None:
        for pit in sorted(yard.pits.all(), key=lambda p: (p.row, p.col)):
            pits.append(
                {
                    "id": pit.id,
                    "code": pit.code,
                    "status": pit.status,
                    "label": STATUS_LABELS.get(pit.status, pit.status),
                    "statusChangedAt": pit.status_changed_at.isoformat(),
                    **cooldown_json(pit),
                }
            )
    return {"rules": items, "pits": pits}


@api.put("/cooldowns/{status}", auth=auth)
def update_cooldown(request, status: str, payload: CooldownIn):
    if request.auth.role != "admin":
        raise HttpError(403, "只有管理员能改冷却分钟，操作工仅可查看")
    if status not in STATUS_LABELS:
        raise HttpError(404, "无效状态")
    if payload.minutes < 0 or payload.minutes > 1440:
        raise HttpError(400, "冷却分钟须为 0～1440 的整数")
    rule, _ = CooldownRule.objects.update_or_create(status=status, defaults={"minutes": payload.minutes})
    return {"status": status, "label": STATUS_LABELS[status], "minutes": rule.minutes}
