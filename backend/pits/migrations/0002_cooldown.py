# 冷却沙漏：坑位记录上次拨态时刻，新增冷却分钟设置

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("pits", "0001_initial")]
    operations = [
        migrations.AddField(
            model_name="pit",
            name="last_status_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="CooldownSetting",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("minutes", models.PositiveIntegerField(default=3)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
