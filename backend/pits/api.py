from django.db import transaction
from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import CooldownSetting, Pit, User, Yard
from pits.rules import (
    RuleError,
    assert_can_set_status,
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


def pit_json(pit: Pit, cooldown_minutes: int) -> dict:
    remaining = cooldown_remaining_seconds(pit, cooldown_minutes)
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
        "lastStatusAt": pit.last_status_at.isoformat() if pit.last_status_at else None,
        "cooling": remaining > 0,
        "cooldownRemainingSec": remaining,
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
    minutes = CooldownSetting.current_minutes()
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p, minutes) for p in pits]}


@api.get("/cooldown", auth=auth)
def get_cooldown(request):
    """冷却沙漏专页数据：分钟数 + 各坑沙漏状态，登录即可看。"""
    minutes = CooldownSetting.current_minutes()
    pits = Pit.objects.order_by("yard_id", "row", "col", "id")
    return {
        "minutes": minutes,
        "minMinutes": CooldownSetting.MIN_MINUTES,
        "now": timezone.now().isoformat(),
        "pits": [pit_json(p, minutes) for p in pits],
    }


@api.put("/cooldown", auth=auth)
def set_cooldown(request, payload: CooldownIn):
    if request.auth.role != "admin":
        raise HttpError(403, "仅管理员可修改冷却分钟，操作工只能查看")
    if payload.minutes < CooldownSetting.MIN_MINUTES:
        raise HttpError(400, f"冷却分钟至少为 {CooldownSetting.MIN_MINUTES}")
    setting = CooldownSetting.current()
    setting.minutes = payload.minutes
    setting.save(update_fields=["minutes", "updated_at"])
    return {"minutes": setting.minutes, "minMinutes": CooldownSetting.MIN_MINUTES}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    # 酸碱登记不读冷却沙漏，任何时候都可登记
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    pit.samples.create(ph=payload.ph, operator=request.auth.username)
    pit.refresh_from_db()
    return pit_json(pit, CooldownSetting.current_minutes())


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    with transaction.atomic():
        pit = Pit.objects.select_for_update().filter(id=pit_id).first()
        if pit is None:
            raise HttpError(404, "坑不存在")
        try:
            assert_can_set_status(pit, payload.status, CooldownSetting.current_minutes())
        except RuleError as exc:
            raise HttpError(400, str(exc))
        pit.status = payload.status
        pit.last_status_at = timezone.now()
        pit.save(update_fields=["status", "last_status_at"])
    return pit_json(pit, CooldownSetting.current_minutes())
