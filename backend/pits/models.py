from django.contrib.auth.hashers import check_password, make_password
from django.db import models


class User(models.Model):
    username = models.CharField(max_length=64, unique=True)
    password_hash = models.CharField(max_length=256)
    role = models.CharField(max_length=20, default="worker")

    def set_password(self, raw: str) -> None:
        self.password_hash = make_password(raw)

    def check_password(self, raw: str) -> bool:
        return check_password(raw, self.password_hash)


class Yard(models.Model):
    name = models.CharField(max_length=120)
    village = models.CharField(max_length=120, blank=True)


class Pit(models.Model):
    STATUS_FILL = "fill"
    STATUS_TANNING = "tanning"
    STATUS_DRAINED = "drained"

    yard = models.ForeignKey(Yard, on_delete=models.CASCADE, related_name="pits")
    code = models.CharField(max_length=40)
    status = models.CharField(max_length=20, default=STATUS_FILL)
    row = models.IntegerField(default=0)
    col = models.IntegerField(default=0)
    last_status_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("yard", "code")


class CooldownSetting(models.Model):
    """冷却沙漏设置（单行）：每次拨态成功后须等待的分钟数。"""

    DEFAULT_MINUTES = 3
    MIN_MINUTES = 3

    minutes = models.PositiveIntegerField(default=DEFAULT_MINUTES)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def current(cls) -> "CooldownSetting":
        setting = cls.objects.order_by("id").first()
        if setting is None:
            setting = cls.objects.create(minutes=cls.DEFAULT_MINUTES)
        return setting

    @classmethod
    def current_minutes(cls) -> int:
        return cls.current().minutes


class LiquorSample(models.Model):
    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="samples")
    taken_at = models.DateTimeField(auto_now_add=True)
    ph = models.FloatField()
    operator = models.CharField(max_length=64, blank=True)
