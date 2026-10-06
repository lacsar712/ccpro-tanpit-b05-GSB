from datetime import timedelta

from django.utils import timezone

from pits.models import CooldownRule, LiquorSample, Pit, User, Yard

DEFAULT_COOLDOWNS = (
    (Pit.STATUS_FILL, 3),
    (Pit.STATUS_TANNING, 10),
    (Pit.STATUS_DRAINED, 5),
)


def seed_demo() -> None:
    admin, _ = User.objects.get_or_create(username="admin", defaults={"role": "admin"})
    admin.role = "admin"
    admin.set_password("123456")
    admin.save()
    worker, _ = User.objects.get_or_create(username="worker", defaults={"role": "worker"})
    worker.role = "worker"
    worker.set_password("123456")
    worker.save()
    for status, minutes in DEFAULT_COOLDOWNS:
        CooldownRule.objects.get_or_create(status=status, defaults={"minutes": minutes})
    if Yard.objects.exists():
        return
    yard = Yard.objects.create(name="南冈鞣场", village="青皮村")
    # 演示坑位落库即“沙漏已满”，一开场就能拨态；拨过之后才开始计时
    long_ago = timezone.now() - timedelta(days=1)
    layout = [
        ("东-1", Pit.STATUS_TANNING, 0, 0, 4.2),
        ("东-2", Pit.STATUS_FILL, 0, 1, None),
        ("中-1", Pit.STATUS_DRAINED, 1, 0, 4.6),
        ("中-2", Pit.STATUS_TANNING, 1, 1, 6.1),
        ("西-1", Pit.STATUS_FILL, 2, 0, None),
        ("西-2", Pit.STATUS_DRAINED, 2, 1, 3.8),
    ]
    for code, status, row, col, ph in layout:
        pit = Pit.objects.create(yard=yard, code=code, status=status, row=row, col=col, status_changed_at=long_ago)
        if ph is not None:
            LiquorSample.objects.create(pit=pit, ph=ph, operator="worker")
