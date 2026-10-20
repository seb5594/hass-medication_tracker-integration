console.info("[medication-tracker-card] script loaded");

const DEFAULT_LANGUAGE = "en";

// UI strings per language. Add a new language by copying the "en" block.
// Placeholders in {curly} braces are filled in by MedicationTrackerCard._t().
const TRANSLATIONS = {
  en: {
    title: "Medications",
    empty: "No medications found.<br>Add medications via the integration settings.",
    as_needed_tag: "As-needed",
    status_on_track: "On track",
    status_overdue: "Overdue",
    status_due_soon: "Due soon",
    status_low_stock: "Low stock",
    status_available_now: "Available now",
    status_limit_reached: "Limit reached",
    status_available_in: "Available {when}",
    availability_take_when_needed: "Take when needed",
    availability_daily_limit: "Daily limit reached",
    availability_next: "Next available {when}",
    label_next_dose: "Next dose",
    label_last_taken: "Last taken",
    label_streak: "Streak",
    label_taken_today: "Taken today",
    label_availability: "Availability",
    label_stock: "Stock",
    streak_days_one: "{count} day",
    streak_days_other: "{count} days",
    action_mark_taken: "Mark taken",
    action_skip: "Skip dose",
    action_top_up: "Top up stock",
    time_in_minutes: "in {minutes}m",
    time_in_hours: "in {hours}h",
    time_in_hours_minutes: "in {hours}h {minutes}m",
    time_minutes_ago: "{minutes}m ago",
    time_now: "now",
  },
  de: {
    title: "Medikamente",
    empty: "Keine Medikamente gefunden.<br>Füge Medikamente über die Integrationseinstellungen hinzu.",
    as_needed_tag: "Bei Bedarf",
    status_on_track: "Im Plan",
    status_overdue: "Überfällig",
    status_due_soon: "Bald fällig",
    status_low_stock: "Vorrat niedrig",
    status_available_now: "Jetzt verfügbar",
    status_limit_reached: "Limit erreicht",
    status_available_in: "Verfügbar {when}",
    availability_take_when_needed: "Bei Bedarf einnehmen",
    availability_daily_limit: "Tageslimit erreicht",
    availability_next: "Nächste Einnahme möglich {when}",
    label_next_dose: "Nächste Einnahme",
    label_last_taken: "Zuletzt genommen",
    label_streak: "Serie",
    label_taken_today: "Heute genommen",
    label_availability: "Verfügbarkeit",
    label_stock: "Vorrat",
    streak_days_one: "{count} Tag",
    streak_days_other: "{count} Tage",
    action_mark_taken: "Als genommen markieren",
    action_skip: "Überspringen",
    action_top_up: "Vorrat auffüllen",
    time_in_minutes: "in {minutes} Min.",
    time_in_hours: "in {hours} Std.",
    time_in_hours_minutes: "in {hours} Std. {minutes} Min.",
    time_minutes_ago: "vor {minutes} Min.",
    time_now: "jetzt",
  },
};

class MedicationTrackerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._medications = [];
    this._hass = null;
    this._language = DEFAULT_LANGUAGE;
  }

  set hass(hass) {
    this._hass = hass;
    this._language = this._resolveLanguage(hass);
    this._buildMedications();
    this._render();
  }

  setConfig(config) {
    this._config = config || {};
  }

  // Uses the language of the HA user profile, reduced to its base tag
  // ("de-AT" -> "de"). Unsupported languages fall back to English.
  _resolveLanguage(hass) {
    const tag = hass.locale?.language || hass.language || DEFAULT_LANGUAGE;
    const base = tag.split("-")[0].toLowerCase();
    return TRANSLATIONS[base] ? base : DEFAULT_LANGUAGE;
  }

  _t(key, params = {}) {
    const template = TRANSLATIONS[this._language][key] ?? TRANSLATIONS[DEFAULT_LANGUAGE][key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");
  }

  // Finds a sibling entity for the same medication as the given base/device.
  // Prefers matching by shared device (robust against entity_id naming drift,
  // e.g. legacy entities registered before a device rename), falling back to
  // guessing "<base>_<suffix>" for older HA frontends without hass.entities.
  _findEntityId(base, domain, suffix, deviceEntityIds) {
    const states = this._hass.states;
    if (deviceEntityIds) {
      const match = deviceEntityIds.find(
        (eid) => eid.startsWith(`${domain}.`) && eid.endsWith(`_${suffix}`)
      );
      if (match) return match;
    }
    const guessed = `${domain}.${base}_${suffix}`;
    return states[guessed] ? guessed : null;
  }

  _buildMed(entityId, state, stripSuffix, nameStripRegex, medType, byDevice) {
    const states = this._hass.states;
    const base = entityId.replace("sensor.", "").replace(stripSuffix, "");
    const friendlyBase = state.attributes.friendly_name?.replace(nameStripRegex, "") || base;
    const registryEntry = this._hass.entities && this._hass.entities[entityId];
    const deviceEntityIds = registryEntry && byDevice[registryEntry.device_id];

    const get = (domain, suffix) => {
      const eid = this._findEntityId(base, domain, suffix, deviceEntityIds);
      return eid ? states[eid] : null;
    };

    const common = {
      name: friendlyBase,
      base,
      last_taken: get("sensor", "last_taken"),
      streak: get("sensor", "streak"),
      taken_today: get("sensor", "taken_today"),
      stock: get("sensor", "stock"),
      low_stock: get("binary_sensor", "low_stock"),
      stock_number: get("number", "stock"),
      btn_taken: get("button", "mark_taken"),
      btn_skipped: get("button", "mark_skipped"),
    };

    if (medType === "as_needed") {
      return {
        ...common,
        med_type: "as_needed",
        next_available: state,
        available: get("binary_sensor", "available"),
      };
    }
    return {
      ...common,
      med_type: "scheduled",
      next_dose: state,
      overdue: get("binary_sensor", "overdue"),
      due_soon: get("binary_sensor", "due_soon"),
    };
  }

  _buildMedications() {
    if (!this._hass) return;
    const states = this._hass.states;
    const entities = this._hass.entities || {};

    // Pre-index entities by device_id so sibling entities on the same
    // medication can be found even if their entity_id doesn't match the
    // "<base>_<suffix>" pattern guessed from another entity's id.
    const byDevice = {};
    for (const [eid, ent] of Object.entries(entities)) {
      if (!ent || !ent.device_id) continue;
      (byDevice[ent.device_id] ??= []).push(eid);
    }

    const nextDoseSensors = Object.entries(states).filter(
      ([id]) => id.startsWith("sensor.") && id.endsWith("_next_dose")
    );

    // Also find PRN medications via next_available sensors
    const nextAvailableSensors = Object.entries(states).filter(
      ([id]) => id.startsWith("sensor.") && id.endsWith("_next_available")
    );

    const scheduledMeds = nextDoseSensors.map(([entityId, state]) =>
      this._buildMed(entityId, state, "_next_dose", /\s*Next Dose$/i, "scheduled", byDevice)
    );

    const asNeededMeds = nextAvailableSensors.map(([entityId, state]) =>
      this._buildMed(entityId, state, "_next_available", /\s*Next Available$/i, "as_needed", byDevice)
    );

    this._medications = [...scheduledMeds, ...asNeededMeds];
  }

  _formatRelative(isoStr) {
    if (!isoStr || isoStr === "unavailable" || isoStr === "unknown") return "—";
    try {
      const d = new Date(isoStr);
      if (isNaN(d)) return "—";
      const now = new Date();
      const diffMin = Math.round((d - now) / 60000);
      if (diffMin > 0 && diffMin < 120) return this._t("time_in_minutes", { minutes: diffMin });
      if (diffMin <= 0 && diffMin > -120) return this._t("time_minutes_ago", { minutes: Math.abs(diffMin) });
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  }

  _hasStock(med) {
    const s = med.stock?.state;
    return !!(med.stock_number && s && s !== "unknown" && s !== "unavailable");
  }

  _renderStockStat(med) {
    if (!this._hasStock(med)) return "";
    const isLow = med.low_stock?.state === "on";
    return `
      <div class="stat">
        <span class="stat-label">${this._t("label_stock")}</span>
        <span class="stat-value${isLow ? " stat-low-stock" : ""}">${med.stock.state}${isLow ? " ⚠️" : ""}</span>
      </div>
    `;
  }

  _renderTopUpButton(med) {
    if (!this._hasStock(med)) return "";
    return `<button class="btn btn-topup" data-entity="${med.stock_number.entity_id}">${this._t("action_top_up")}</button>`;
  }

  _renderScheduledMed(med) {
    const isOverdue = med.overdue?.state === "on";
    const isDueSoon = med.due_soon?.state === "on";
    const isLowStock = med.low_stock?.state === "on";
    let rowClass = "med-row";
    let badge = `<span class="status-badge badge-ok">${this._t("status_on_track")}</span>`;
    if (isOverdue) { rowClass += " overdue"; badge = `<span class="status-badge badge-overdue">${this._t("status_overdue")}</span>`; }
    else if (isDueSoon) { rowClass += " due-soon"; badge = `<span class="status-badge badge-due-soon">${this._t("status_due_soon")}</span>`; }
    if (isLowStock) badge += `<span class="status-badge badge-low-stock">${this._t("status_low_stock")}</span>`;

    const nextDose = this._formatRelative(med.next_dose?.state);
    const lastTaken = this._formatRelative(med.last_taken?.state);
    const streak = med.streak?.state ?? "0";
    const streakPlural = new Intl.PluralRules(this._language).select(Number(streak)) === "one" ? "one" : "other";
    const streakText = this._t(`streak_days_${streakPlural}`, { count: streak });
    const takenToday = med.taken_today?.state ?? "0";
    const scheduledToday = med.taken_today?.attributes?.doses_scheduled_today ?? "?";
    const btnTakenId = med.btn_taken ? med.btn_taken.entity_id : null;
    const btnSkippedId = med.btn_skipped ? med.btn_skipped.entity_id : null;

    return `
      <div class="${rowClass}">
        <div class="med-name">${med.name}${badge}</div>
        <div class="stats">
          <div class="stat"><span class="stat-label">${this._t("label_next_dose")}</span><span class="stat-value">${nextDose}</span></div>
          <div class="stat"><span class="stat-label">${this._t("label_last_taken")}</span><span class="stat-value">${lastTaken}</span></div>
          <div class="stat"><span class="stat-label">${this._t("label_streak")}</span><span class="stat-value">${streakText}</span></div>
          <div class="stat"><span class="stat-label">${this._t("label_taken_today")}</span><span class="stat-value">${takenToday} / ${scheduledToday}</span></div>
          ${this._renderStockStat(med)}
        </div>
        <div class="actions">
          ${btnTakenId ? `<button class="btn btn-taken" data-entity="${btnTakenId}">${this._t("action_mark_taken")}</button>` : ""}
          ${btnSkippedId ? `<button class="btn btn-skipped" data-entity="${btnSkippedId}">${this._t("action_skip")}</button>` : ""}
          ${this._renderTopUpButton(med)}
        </div>
      </div>
    `;
  }

  _renderAsNeededMed(med) {
    const isAvailable = med.available?.state === "on";
    const nextAvailableStr = med.next_available?.state;
    const maxPerDay = med.next_available?.attributes?.as_needed_max_per_day ?? "?";
    const takenToday = med.taken_today?.state ?? "0";
    const lastTaken = this._formatRelative(med.last_taken?.state);
    const btnTakenId = med.btn_taken ? med.btn_taken.entity_id : null;
    const isLowStock = med.low_stock?.state === "on";

    let rowClass = "med-row";
    let badge;
    let availabilityInfo;

    if (isAvailable) {
      rowClass += " available";
      badge = `<span class="status-badge badge-ok">${this._t("status_available_now")}</span>`;
      availabilityInfo = this._t("availability_take_when_needed");
    } else if (!nextAvailableStr || nextAvailableStr === "unavailable" || nextAvailableStr === "unknown") {
      badge = `<span class="status-badge badge-limit">${this._t("status_limit_reached")}</span>`;
      availabilityInfo = this._t("availability_daily_limit");
    } else {
      rowClass += " as-needed-waiting";
      const countdown = this._formatCountdown(nextAvailableStr);
      badge = `<span class="status-badge badge-waiting">${this._t("status_available_in", { when: countdown })}</span>`;
      availabilityInfo = this._t("availability_next", { when: countdown });
    }
    if (isLowStock) badge += `<span class="status-badge badge-low-stock">${this._t("status_low_stock")}</span>`;

    return `
      <div class="${rowClass}">
        <div class="med-name">${med.name}<span class="as-needed-tag">${this._t("as_needed_tag")}</span>${badge}</div>
        <div class="stats">
          <div class="stat"><span class="stat-label">${this._t("label_availability")}</span><span class="stat-value">${availabilityInfo}</span></div>
          <div class="stat"><span class="stat-label">${this._t("label_last_taken")}</span><span class="stat-value">${lastTaken}</span></div>
          <div class="stat"><span class="stat-label">${this._t("label_taken_today")}</span><span class="stat-value">${takenToday} / ${maxPerDay}</span></div>
          ${this._renderStockStat(med)}
        </div>
        <div class="actions">
          ${btnTakenId ? `<button class="btn btn-taken${isAvailable ? "" : " btn-disabled"}" data-entity="${btnTakenId}" ${isAvailable ? "" : "disabled"}>${this._t("action_mark_taken")}</button>` : ""}
          ${this._renderTopUpButton(med)}
        </div>
      </div>
    `;
  }

  _formatCountdown(isoStr) {
    if (!isoStr || isoStr === "unavailable" || isoStr === "unknown") return "—";
    try {
      const d = new Date(isoStr);
      if (isNaN(d)) return "—";
      const now = new Date();
      const diffMin = Math.round((d - now) / 60000);
      if (diffMin <= 0) return this._t("time_now");
      if (diffMin < 60) return this._t("time_in_minutes", { minutes: diffMin });
      const hours = Math.floor(diffMin / 60);
      const minutes = diffMin % 60;
      return minutes > 0
        ? this._t("time_in_hours_minutes", { hours, minutes })
        : this._t("time_in_hours", { hours });
    } catch { return "—"; }
  }

  async _callButton(entityId) {
    if (!this._hass) return;
    await this._hass.callService("button", "press", { entity_id: entityId });
  }

  _openMoreInfo(entityId) {
    // Opens HA's built-in more-info dialog for the stock number entity, which
    // has its own +/- controls for topping up or correcting stock — no need
    // to hand-roll an amount prompt here.
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }));
  }

  _render() {
    if (!this.shadowRoot) return;

    const style = `
      :host { display: block; }
      .card { background: var(--card-background-color, #fff); border-radius: 12px; padding: 16px; }
      .card-header { font-size: 16px; font-weight: 500; color: var(--primary-text-color); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
      .med-row { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px; padding: 12px; margin-bottom: 10px; }
      .med-row:last-child { margin-bottom: 0; }
      .med-row.overdue { border-color: var(--error-color, #db4437); background: rgba(219,68,55,0.06); }
      .med-row.due-soon { border-color: var(--warning-color, #ffa600); background: rgba(255,166,0,0.06); }
      .med-name { font-size: 15px; font-weight: 500; color: var(--primary-text-color); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .status-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
      .badge-overdue { background: var(--error-color, #db4437); color: white; }
      .badge-due-soon { background: var(--warning-color, #ffa600); color: white; }
      .badge-ok { background: var(--success-color, #43a047); color: white; }
      .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin-bottom: 10px; }
      .stat { display: flex; flex-direction: column; }
      .stat-label { font-size: 11px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.04em; }
      .stat-value { font-size: 13px; color: var(--primary-text-color); font-weight: 500; }
      .actions { display: flex; gap: 8px; margin-top: 8px; }
      .btn { flex: 1; padding: 7px 0; border-radius: 6px; border: none; font-size: 13px; font-weight: 500; cursor: pointer; transition: opacity 0.15s; }
      .btn:active { opacity: 0.7; }
      .btn-taken { background: var(--primary-color, #03a9f4); color: white; }
      .btn-skipped { background: var(--secondary-background-color, #f5f5f5); color: var(--primary-text-color); border: 1px solid var(--divider-color, #e0e0e0); }
      .empty { text-align: center; color: var(--secondary-text-color); padding: 24px; font-size: 14px; line-height: 1.6; }
      .med-row.available { border-color: var(--success-color, #43a047); background: rgba(67,160,71,0.06); }
      .med-row.as-needed-waiting { border-color: var(--warning-color, #ffa600); background: rgba(255,166,0,0.06); }
      .as-needed-tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--secondary-background-color); color: var(--secondary-text-color); border: 1px solid var(--divider-color); font-weight: 500; }
      .badge-waiting { background: var(--warning-color, #ffa600); color: white; }
      .badge-limit { background: var(--error-color, #db4437); color: white; }
      .btn-disabled { opacity: 0.4; cursor: not-allowed; }
      .badge-low-stock { background: var(--warning-color, #ffa600); color: white; }
      .stat-low-stock { color: var(--warning-color, #ffa600); }
      .btn-topup { background: var(--secondary-background-color, #f5f5f5); color: var(--primary-text-color); border: 1px solid var(--divider-color, #e0e0e0); flex: 0 0 auto; padding: 7px 12px; }
    `;

    let rows;
    if (this._medications.length === 0) {
      rows = `<div class="empty">${this._t("empty")}</div>`;
    } else {
      rows = this._medications.map(med => {
        if (med.med_type === "as_needed") {
          return this._renderAsNeededMed(med);
        }
        return this._renderScheduledMed(med);
      }).join("");
    }

    this.shadowRoot.innerHTML = `
      <style>${style}</style>
      <div class="card">
        <div class="card-header">💊 ${this._t("title")}</div>
        ${rows}
      </div>
    `;

    this.shadowRoot.querySelectorAll(".btn[data-entity]").forEach(btn => {
      if (btn.classList.contains("btn-topup")) {
        btn.addEventListener("click", () => this._openMoreInfo(btn.dataset.entity));
      } else {
        btn.addEventListener("click", () => this._callButton(btn.dataset.entity));
      }
    });
  }

  getCardSize() {
    return 1 + this._medications.length * 2;
  }

  static getStubConfig() {
    return {};
  }
}

// The file may be loaded twice, e.g. by the integration and by a resource
// that was added manually in an earlier version. Registering again would throw.
if (!customElements.get("medication-tracker-card")) {
  customElements.define("medication-tracker-card", MedicationTrackerCard);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "medication-tracker-card",
    name: "Medication Tracker",
    description: "Shows all medications with status and mark taken / skip buttons.",
    preview: false,
  });
}
