"""冷却沙漏验收场景：用 SQLite 起库，逐个核对需求。直接 python3 运行。"""

import os
import sys
from datetime import timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django
from django.conf import settings

settings.DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
django.setup()

from django.core.management import call_command
from django.utils import timezone

call_command("migrate", run_syncdb=True, verbosity=0)
call_command("seed", verbosity=0)

from ninja.testing import TestClient

from pits.api import api
from pits.models import CooldownSetting, Pit

client = TestClient(api)

PASS, FAIL = "✅", "❌"
failures = []


def check(name, cond, detail=""):
    print(f"{PASS if cond else FAIL} {name}" + (f" —— {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def login(username, password="123456"):
    r = client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.content
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


admin = login("admin")
worker = login("worker")
worker2 = login("worker")  # 第二名操作工（同工种另一人）

# ── 1. 专页列出分钟（至少 3），登录即可看 ─────────────────
r = client.get("/cooldown", headers=worker)
check("专页列出冷却分钟且 >= 3", r.status_code == 200 and r.json()["minutes"] >= 3, r.content)
check("专页列出各坑沙漏", len(r.json()["pits"]) == 6)

# ── 2. 只有管理员能改数字，操作工只能看 ───────────────────
r = client.put("/cooldown", json={"minutes": 5}, headers=worker)
check("操作工改分钟被 403 中文挡住", r.status_code == 403 and "管理员" in str(r.json()), r.content)
r = client.put("/cooldown", json={"minutes": 1}, headers=admin)
check("分钟低于 3 被 400 挡住", r.status_code == 400 and "至少" in str(r.json()), r.content)
r = client.put("/cooldown", json={"minutes": 3}, headers=admin)
check("管理员改分钟成功", r.status_code == 200 and r.json()["minutes"] == 3, r.content)

# ── 3. 刚拨态成功后马上再拨：中文挡住且坑态不变 ───────────
pit = Pit.objects.get(code="东-2")  # fill，无酸碱记录
r = client.post(f"/pits/{pit.id}/status", json={"status": "tanning"}, headers=worker)
check("第一次拨态成功", r.status_code == 200 and r.json()["status"] == "tanning", r.content)
check("成功后进入冷却", r.json()["cooling"] is True and r.json()["cooldownRemainingSec"] > 0)

r2 = client.post(f"/pits/{pit.id}/status", json={"status": "fill"}, headers=worker)
check("马上再拨被 400 中文挡住", r2.status_code == 400 and "冷却未满" in str(r2.json()), r2.content)
pit.refresh_from_db()
check("第二笔没有改掉坑态", pit.status == "tanning", pit.status)

# ── 4. 顺着抽屉那次拨态核对沙漏：专页写未满，拨态必须失败 ──
r = client.get("/cooldown", headers=worker)
row = next(p for p in r.json()["pits"] if p["code"] == "东-2")
check("专页对该坑写未满", row["cooling"] is True and row["cooldownRemainingSec"] > 0)
r = client.post(f"/pits/{pit.id}/status", json={"status": "drained"}, headers=admin)
check("专页未满时抽屉拨不过去", r.status_code == 400, r.content)
pit.refresh_from_db()
check("坑态仍未被改掉", pit.status == "tanning", pit.status)

# ── 5. 酸碱登记不读沙漏：冷却中照样登记成功 ───────────────
r = client.post(f"/pits/{pit.id}/samples", json={"ph": 4.4}, headers=worker)
check("冷却中酸碱登记成功", r.status_code == 200 and r.json()["latestPh"] == 4.4, r.content)

# ── 6. 沙漏不得放空酸碱过关：无记录放液仍被挡 ─────────────
pit_kong = Pit.objects.get(code="西-1")  # fill，无酸碱记录，无冷却
r = client.post(f"/pits/{pit_kong.id}/status", json={"status": "drained"}, headers=admin)
check("空酸碱放液被中文挡住", r.status_code == 400 and "酸碱" in str(r.json()), r.content)
pit_kong.refresh_from_db()
check("空酸碱坑态不变", pit_kong.status == "fill")

# ── 7. 已放液仍认 3.5～5.0：超范围不放液 ──────────────────
pit_bad = Pit.objects.get(code="中-2")  # tanning，pH 6.1
r = client.post(f"/pits/{pit_bad.id}/status", json={"status": "drained"}, headers=admin)
check("pH 6.1 放液被挡住", r.status_code == 400 and "3.5" in str(r.json()), r.content)
pit_ok = Pit.objects.get(code="东-1")  # tanning，pH 4.2
r = client.post(f"/pits/{pit_ok.id}/status", json={"status": "drained"}, headers=admin)
check("pH 4.2 放液成功", r.status_code == 200 and r.json()["status"] == "drained", r.content)

# ── 8. 两名工刚拨完马上抢着再各拨一次，两笔都落空 ──────────
pit2 = Pit.objects.get(code="西-2")  # drained，pH 3.8
r = client.post(f"/pits/{pit2.id}/status", json={"status": "fill"}, headers=worker)
check("甲工拨态成功", r.status_code == 200, r.content)
r1 = client.post(f"/pits/{pit2.id}/status", json={"status": "tanning"}, headers=worker)
r2 = client.post(f"/pits/{pit2.id}/status", json={"status": "tanning"}, headers=worker2)
check("甲工抢拨落空", r1.status_code == 400 and "冷却未满" in str(r1.json()), r1.content)
check("乙工抢拨也落空", r2.status_code == 400 and "冷却未满" in str(r2.json()), r2.content)
pit2.refresh_from_db()
check("两笔都没改掉坑态", pit2.status == "fill", pit2.status)

# ── 9. 沙漏流满后（模拟时间过去）可以再拨 ──────────────────
Pit.objects.filter(id=pit2.id).update(last_status_at=timezone.now() - timedelta(minutes=3, seconds=1))
r = client.post(f"/pits/{pit2.id}/status", json={"status": "tanning"}, headers=worker)
check("沙漏流满后可再拨", r.status_code == 200 and r.json()["status"] == "tanning", r.content)

# ── 10. 场地图也带沙漏标记 ────────────────────────────────
r = client.get("/board", headers=worker)
check("场地图返回各坑沙漏状态", r.status_code == 200 and all("cooling" in p for p in r.json()["pits"]))

print()
if failures:
    print(f"失败 {len(failures)} 项：{failures}")
    sys.exit(1)
print("全部验收场景通过")
