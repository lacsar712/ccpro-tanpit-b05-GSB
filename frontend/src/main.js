import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const ROLE_LABELS = { admin: "管理员", worker: "操作工" };

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

function fmtRemain(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m && r) return `${m} 分 ${r} 秒`;
  if (m) return `${m} 分钟`;
  return `${r} 秒`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    me: { type: Object },
    view: { type: String },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    notice: { type: String },
    cooldown: { type: Object },
    minutesInput: { type: String },
    username: { type: String },
    password: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 16px 16px 50px; }
    .topbar {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 10px 12px; margin: 0 0 16px; border-radius: 8px;
      background: #3d2f23; color: #f5ead9;
    }
    .topbar .brand { font-weight: bold; margin-right: 12px; }
    .topbar button {
      font: inherit; padding: 6px 14px; border-radius: 6px; cursor: pointer;
      border: 1px solid #8a7358; background: transparent; color: #f5ead9;
    }
    .topbar button.active { background: #c8a45f; border-color: #c8a45f; color: #2b2118; font-weight: bold; }
    .topbar .spacer { flex: 1; }
    .topbar .who { font-size: 0.92em; color: #d9c7a7; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; font: inherit; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .ok { color: #2f6b2f; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 10px; }
    th, td { border: 1px solid #cbb894; padding: 8px 10px; text-align: left; }
    th { background: #efe3c8; }
    .cooling { color: #9b5a1c; font-weight: bold; }
    .free { color: #2f6b2f; }
    .overlay {
      position: fixed; inset: 0; background: rgba(30, 20, 10, 0.45); z-index: 10;
    }
    .drawer {
      position: fixed; top: 0; right: 0; bottom: 0; width: 320px; max-width: 88vw;
      background: #fbf5e8; z-index: 11; padding: 20px 18px; overflow-y: auto;
      box-shadow: -4px 0 16px rgba(0, 0, 0, 0.25);
    }
    .drawer h3 { margin-top: 0; }
    .drawer .close { float: right; }
    .card { border: 1px solid #cbb894; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; background: #fbf5e8; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.me = null;
    this.view = "map";
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.notice = "";
    this.cooldown = null;
    this.minutesInput = "3";
    this.username = "admin";
    this.password = "123456";
    this._timer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.boot();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopTimer();
  }

  async boot() {
    try {
      this.me = await api("/api/auth/me");
      await this.refresh();
    } catch (e) {
      this.logout();
    }
  }

  _startTimer() {
    this._stopTimer();
    this._timer = setInterval(() => this.loadCooldown(), 10000);
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async switchView(view) {
    this.view = view;
    this.err = "";
    this.notice = "";
    this.picked = null;
    if (view === "hourglass") {
      await this.loadCooldown();
      this._startTimer();
    } else {
      this._stopTimer();
      await this.refresh();
    }
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || this.board.pits[0];
      }
    } catch (e) {
      this.err = e.message;
    }
  }

  async loadCooldown() {
    try {
      this.cooldown = await api("/api/cooldown");
      this.minutesInput = String(this.cooldown.minutes);
    } catch (e) {
      this.err = e.message;
    }
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

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this._stopTimer();
    this.ready = false;
    this.me = null;
    this.board = null;
    this.picked = null;
    this.cooldown = null;
    this.view = "map";
    this.err = "";
    this.notice = "";
  }

  async saveMinutes() {
    this.err = "";
    this.notice = "";
    try {
      const data = await api("/api/cooldown", {
        method: "PUT",
        body: JSON.stringify({ minutes: Number(this.minutesInput) }),
      });
      this.notice = `已保存：冷却分钟调整为 ${data.minutes} 分钟`;
      await this.loadCooldown();
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
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async setStatus(status) {
    this.err = "";
    this.notice = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      this.notice = `已拨为「${LABELS[status]}」，冷却沙漏开始计时`;
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
      await this.refresh();
    }
  }

  renderTopbar() {
    return html`<nav class="topbar">
      <span class="brand">南冈鞣场</span>
      <button class=${this.view === "map" ? "active" : ""} @click=${() => this.switchView("map")}>坑位场地图</button>
      <button class=${this.view === "hourglass" ? "active" : ""} @click=${() => this.switchView("hourglass")}>冷却沙漏</button>
      <span class="spacer"></span>
      ${this.me
        ? html`<span class="who">${this.me.username}（${ROLE_LABELS[this.me.role] || this.me.role}）</span>`
        : ""}
      <button @click=${this.logout}>退出</button>
    </nav>`;
  }

  renderMap() {
    if (!this.board) return html`${this.err ? html`<p class="err">${this.err}</p>` : "装载坑位…"}`;
    return html`
      <p>${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0；拨态后须等沙漏流满</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => { this.picked = p; this.err = ""; this.notice = ""; }}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
            ${p.cooling ? html`<br />⏳ 冷却未满` : ""}
          </button>`
        )}
      </div>
      ${this.picked ? this.renderDrawer() : ""}
    `;
  }

  renderDrawer() {
    const p = this.picked;
    return html`
      <div class="overlay" @click=${() => (this.picked = null)}></div>
      <aside class="drawer">
        <button class="close" @click=${() => (this.picked = null)}>关闭</button>
        <h3>${p.code} · ${LABELS[p.status]}</h3>
        <p>最近酸碱度：${p.latestPh ?? "无"} · 共登记 ${p.sampleCount} 次</p>
        ${p.cooling
          ? html`<p class="cooling">⏳ 冷却未满，还需等待 ${fmtRemain(p.cooldownRemainingSec)}，暂不能拨态</p>`
          : html`<p class="free">沙漏已流满，可以拨态</p>`}
        <label>浸液酸碱度
          <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
        </label>
        <button @click=${this.writePh}>登记酸碱度</button>
        <p class="hint">酸碱登记不受沙漏限制；拨态受冷却沙漏限制</p>
        <div>
          <button @click=${() => this.setStatus("fill")}>注液</button>
          <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
          <button @click=${() => this.setStatus("drained")}>已放液</button>
        </div>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
        ${this.notice ? html`<p class="ok">${this.notice}</p>` : ""}
      </aside>
    `;
  }

  renderHourglass() {
    const cd = this.cooldown;
    if (!cd) return html`${this.err ? html`<p class="err">${this.err}</p>` : "装载沙漏…"}`;
    const isAdmin = this.me && this.me.role === "admin";
    return html`
      <div class="card">
        <h2>冷却沙漏</h2>
        <p class="hint">
          每次拨态成功后，须等待沙漏流满（${cd.minutes} 分钟）才能再次拨态；
          酸碱登记不读沙漏，随时可登记；放液仍须最近酸碱度在 3.5～5.0。
        </p>
        <p>
          冷却分钟：<strong>${cd.minutes} 分钟</strong>
          ${isAdmin
            ? html`<br /><label>调整分钟（至少 ${cd.minMinutes} 分钟）
                  <input type="number" min=${cd.minMinutes} .value=${this.minutesInput}
                    @input=${(e) => (this.minutesInput = e.target.value)} />
                </label>
                <button @click=${this.saveMinutes}>保存分钟</button>`
            : html`<span class="hint">（仅管理员可修改，操作工只能查看）</span>`}
        </p>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
        ${this.notice ? html`<p class="ok">${this.notice}</p>` : ""}
      </div>
      <div class="card">
        <h3>各坑沙漏</h3>
        <button @click=${this.loadCooldown}>刷新</button>
        <table>
          <thead>
            <tr><th>坑位</th><th>状态</th><th>上次拨态</th><th>沙漏</th></tr>
          </thead>
          <tbody>
            ${cd.pits.map(
              (p) => html`<tr>
                <td>${p.code}</td>
                <td>${LABELS[p.status]}</td>
                <td>${fmtTime(p.lastStatusAt)}</td>
                <td>
                  ${p.cooling
                    ? html`<span class="cooling">⏳ 未满，还需 ${fmtRemain(p.cooldownRemainingSec)}</span>`
                    : html`<span class="free">✅ 已流满，可拨态</span>`}
                </td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    `;
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
    return html`<div class="wrap">
      ${this.renderTopbar()}
      ${this.view === "map" ? this.renderMap() : this.renderHourglass()}
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);
