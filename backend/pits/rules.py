"""鞣坑门槛：放液看酸碱（3.5～5.0），拨态看冷却沙漏；两条线互不替代。"""

from django.utils import timezone

from pits.models import CooldownRule, Pit

MIN_PH = 3.5
MAX_PH = 5.0

STATUS_LABELS = {
    Pit.STATUS_FILL: "注液",
    Pit.STATUS_TANNING: "鞣制中",
    Pit.STATUS_DRAINED: "已放液",
}


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def cooldown_minutes(status: str) -> int:
    rule = CooldownRule.objects.filter(status=status).first()
    return rule.minutes if rule is not None else 0


def cooldown_remaining_seconds(pit: Pit) -> int:
    """当前状态的沙漏还差多少秒才满；0 表示已满、可再拨。"""
    minutes = cooldown_minutes(pit.status)
    if minutes <= 0:
        return 0
    elapsed = (timezone.now() - pit.status_changed_at).total_seconds()
    return max(0, round(minutes * 60 - elapsed))


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    remaining = cooldown_remaining_seconds(pit)
    if remaining > 0:
        label = STATUS_LABELS.get(pit.status, pit.status)
        wait = (remaining + 59) // 60
        raise RuleError(f"「{label}」冷却未满，还需静候约 {wait} 分钟，暂不能拨态")
    if new_status != Pit.STATUS_DRAINED:
        return
    ph = latest_ph(pit)
    if ph is None:
        raise RuleError("该坑尚无浸液酸碱记录，不能放液")
    if ph < MIN_PH or ph > MAX_PH:
        raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
