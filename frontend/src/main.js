import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

const waitText = (seconds) => `还需静候约 ${Math.max(1, Math.ceil(seconds / 60))} 分钟`;

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    me: { type: Object },
    view: { type: String },
    board: { type: Object },
    hourglass: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    notice: { type: String },
    username: { type: String },
    password: { type: String },
    editMinutes: { type: Object },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 14px; padding: 10px 18px; background: #2b2118; color: #f3e9d8; }
    .top .brand { font-weight: bold; font-size: 1.1em; }
    .top nav button { background: transparent; color: #e8dcc4; border: 1px solid #6b5a48; border-radius: 6px; padding: 6px 14px; cursor: pointer; font: inherit; }
    .top nav button.on { background: #f3e9d8; color: #2b2118; }
    .top .who { margin-left: auto; font-size: 0.9em; color: #cbbfa9; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 220px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .ok { color: #2f6b2f; }
    .warn { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    table { border-collapse: collapse; margin: 10px 0 18px; width: 100%; }
    th, td { border: 1px solid #cbbfa9; padding: 8px 14px; text-align: left; }
    th { background: #f0e7d3; }
    .drawer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: #fbf7ee; border-top: 3px solid #8a5a2b; box-shadow: 0 -8px 22px rgba(0, 0, 0, 0.28); }
    .drawer-inner { position: relative; max-width: 880px; margin: 0 auto; padding: 16px; }
    .close { position: absolute; top: 8px; right: 12px; border: 0; background: transparent; font-size: 1.3em; cursor: pointer; color: #6b5a48; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.me = null;
    this.view = "map";
    this.board = null;
    this.hourglass = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.notice = "";
    this.username = "admin";
    this.password = "123456";
    this.editMinutes = {};
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.boot();
  }

  async boot() {
    try {
      this.me = await api("/api/auth/me");
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      this.ready = false;
      return;
    }
    await this.refresh();
  }

  async refresh() {
    try {
      const [board, hourglass] = await Promise.all([api("/api/board"), api("/api/cooldowns")]);
      this.board = board;
      this.hourglass = hourglass;
      if (!Object.keys(this.editMinutes).length) {
        this.editMinutes = Object.fromEntries(hourglass.rules.map((r) => [r.status, String(r.minutes)]));
      }
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || null;
      }
    } catch (e) {
      this.err = e.message;
    }
  }

  show(view) {
    this.view = view;
    this.err = "";
    this.notice = "";
    this.refresh();
  }

  async login(e) {
    e.preventDefault();
    this.err = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      this.me = data.user;
      this.ready = true;
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async writePh() {
    this.err = "";
    this.notice = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      this.notice = "酸碱度已登记";
    } catch (ex) {
      this.err = ex.message;
    }
    await this.refresh();
  }

  async setStatus(status) {
    this.err = "";
    this.notice = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      this.notice = `已拨为「${LABELS[status]}」，沙漏重新计时`;
    } catch (ex) {
      this.err = ex.message;
    }
    await this.refresh();
  }

  async saveCooldown(status) {
    this.err = "";
    this.notice = "";
    const minutes = Number(this.editMinutes[status]);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      this.err = "冷却分钟须为 0～1440 的整数";
      return;
    }
    try {
      await api(`/api/cooldowns/${status}`, { method: "PUT", body: JSON.stringify({ minutes }) });
      this.notice = `「${LABELS[status]}」冷却分钟已保存`;
    } catch (ex) {
      this.err = ex.message;
    }
    await this.refresh();
  }

  renderMap() {
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    const cd = this.picked && this.picked.cooldown;
    return html`<div class="wrap">
      <p>${this.board.village} · 点坑开抽屉：登记浸液酸碱度、拨状态；放液须最近读数 3.5～5.0，拨态须沙漏已满</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => { this.picked = p; this.err = ""; this.notice = ""; }}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}<br />
            <small>${p.cooldown.ready ? "沙漏已满" : `沙漏未满 · ${waitText(p.cooldown.remainingSeconds)}`}</small>
          </button>`
        )}
      </div>
      ${this.err && !this.picked ? html`<p class="err">${this.err}</p>` : ""}
      ${this.picked
        ? html`<div class="drawer"><div class="drawer-inner">
            <button class="close" @click=${() => (this.picked = null)}>×</button>
            <h3>${this.picked.code} · ${LABELS[this.picked.status]}</h3>
            <p>最近酸碱度：${this.picked.latestPh ?? "无"} · ${this.picked.sampleCount} 次</p>
            <p class=${cd.ready ? "ok" : "warn"}>
              ${cd.ready
                ? "沙漏已满，可以拨态"
                : `「${LABELS[this.picked.status]}」沙漏未满，${waitText(cd.remainingSeconds)}，拨态会被挡下`}
            </p>
            <div>
              <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
              <button @click=${this.writePh}>登记酸碱度</button>
              <span class="hint">登记酸碱不读沙漏，随时可登</span>
            </div>
            <div>
              <button @click=${() => this.setStatus("fill")}>注液</button>
              <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button @click=${() => this.setStatus("drained")}>已放液</button>
            </div>
            ${this.err ? html`<p class="err">${this.err}</p>` : ""}
            ${this.notice ? html`<p class="ok">${this.notice}</p>` : ""}
          </div></div>`
        : ""}
    </div>`;
  }

  renderHourglass() {
    const hg = this.hourglass;
    if (!hg) return html`<div class="wrap">${this.err || "装载沙漏…"}</div>`;
    const isAdmin = this.me && this.me.role === "admin";
    return html`<div class="wrap">
      <h2>冷却沙漏</h2>
      <p class="hint">拨入某状态后须静候对应分钟，期间任何拨态都会被中文挡下且坑态不变。
        ${isAdmin ? "你是管理员，可改下面的分钟数。" : "操作工仅可查看，分钟数由管理员维护。"}</p>
      <table>
        <thead><tr><th>状态</th><th>冷却分钟</th>${isAdmin ? html`<th>操作</th>` : ""}</tr></thead>
        <tbody>
          ${hg.rules.map(
            (r) => html`<tr>
              <td>${r.label}</td>
              <td>${isAdmin
                ? html`<input type="number" min="0" max="1440" .value=${this.editMinutes[r.status] ?? String(r.minutes)}
                      @input=${(e) => (this.editMinutes = { ...this.editMinutes, [r.status]: e.target.value })} /> 分钟`
                : html`${r.minutes} 分钟`}</td>
              ${isAdmin ? html`<td><button @click=${() => this.saveCooldown(r.status)}>保存</button></td>` : ""}
            </tr>`
          )}
        </tbody>
      </table>
      <h3>各坑沙漏</h3>
      <table>
        <thead><tr><th>坑位</th><th>当前状态</th><th>沙漏</th></tr></thead>
        <tbody>
          ${hg.pits.map(
            (p) => html`<tr>
              <td>${p.code}</td>
              <td>${p.label}</td>
              <td class=${p.ready ? "ok" : "warn"}>${p.ready ? "已满，可拨态" : `未满，${waitText(p.remainingSeconds)}`}</td>
            </tr>`
          )}
        </tbody>
      </table>
      <button @click=${this.refresh}>刷新</button>
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      ${this.notice ? html`<p class="ok">${this.notice}</p>` : ""}
    </div>`;
  }

  render() {
    if (!this.ready) {
      return html`<div class="wrap">
        <h1>南冈鞣场</h1>
        <form @submit=${this.login} autocomplete="off">
          <label>用户名
            <input name="username" autocomplete="off" .value=${this.username} @input=${(e) => (this.username = e.target.value)} />
          </label>
          <label>密码
            <input name="password" type="password" autocomplete="off" .value=${this.password} @input=${(e) => (this.password = e.target.value)} />
          </label>
          <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
          <button>登录</button>
        </form>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </div>`;
    }
    return html`
      <header class="top">
        <span class="brand">南冈鞣场</span>
        <nav>
          <button class=${this.view === "map" ? "on" : ""} @click=${() => this.show("map")}>坑位场地图</button>
          <button class=${this.view === "hourglass" ? "on" : ""} @click=${() => this.show("hourglass")}>冷却沙漏</button>
        </nav>
        <span class="who">${this.me ? `${this.me.username} · ${this.me.role === "admin" ? "管理员" : "操作工"}` : ""}</span>
      </header>
      ${this.view === "map" ? this.renderMap() : this.renderHourglass()}
    `;
  }
}

customElements.define("tan-yard", TanYard);
