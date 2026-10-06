"""鞣坑放液门槛：最近一次浸液酸碱度须在 3.5～5.0；拨态受冷却沙漏限制。"""

from datetime import datetime

from django.utils import timezone

from pits.models import Pit

MIN_PH = 3.5
MAX_PH = 5.0


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def cooldown_remaining_seconds(pit: Pit, minutes: int, now: datetime | None = None) -> int:
    """距沙漏流满还剩多少秒；未在冷却中返回 0。酸碱登记不读此沙漏。"""
    if pit.last_status_at is None:
        return 0
    now = now or timezone.now()
    elapsed = (now - pit.last_status_at).total_seconds()
    return max(0, round(minutes * 60 - elapsed))


def format_remaining(seconds: int) -> str:
    minutes, secs = divmod(max(0, seconds), 60)
    if minutes and secs:
        return f"{minutes} 分 {secs} 秒"
    if minutes:
        return f"{minutes} 分钟"
    return f"{secs} 秒"


def assert_can_set_status(pit: Pit, new_status: str, cooldown_minutes: int) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status == Pit.STATUS_DRAINED:
        ph = latest_ph(pit)
        if ph is None:
            raise RuleError("该坑尚无浸液酸碱记录，不能放液")
        if ph < MIN_PH or ph > MAX_PH:
            raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
    remaining = cooldown_remaining_seconds(pit, cooldown_minutes)
    if remaining > 0:
        raise RuleError(
            f"冷却未满：每次拨态后须等待 {cooldown_minutes} 分钟，"
            f"还需等待 {format_remaining(remaining)}"
        )
