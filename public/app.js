const state = {
  participants: ["", "", ""],
  exclusions: [],
  exchangeId: new URLSearchParams(location.search).get("exchange") || "",
};

const $ = (selector) => document.querySelector(selector);
const organizerPanel = $("#organizer-panel");
const revealPanel = $("#reveal-panel");
const successPanel = $("#success-panel");
const recoveryPanel = $("#recovery-panel");
const organizerMessage = $("#organizer-message");
const revealMessage = $("#reveal-message");
const exchangeCodeMessage = $("#exchange-code-message");
const resetControl = $("#reset-control");

initializeTheme();
initialize();

function initializeTheme() {
  let theme;
  try {
    theme = localStorage.getItem("secret-santa-theme");
  } catch {
    theme = null;
  }
  setTheme(
    theme === "dark" || theme === "light"
      ? theme
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
  );
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("secret-santa-theme", next);
    } catch {
      // The selected theme still applies for this visit when storage is unavailable.
    }
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark";
  $("#theme-toggle").setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
  $("#theme-toggle span").textContent = dark ? "☀" : "☾";
}

function initialize() {
  bindTabs();
  bindOrganizer();
  bindReveal();
  bindReset();
  renderParticipants();

  if (new URLSearchParams(location.search).get("recovery") === "1") {
    showRecovery();
  } else if (state.exchangeId) {
    switchMode("reveal");
  }

  const admin = getAdminRuns().find((run) => run.exchangeId === state.exchangeId);
  resetControl.hidden = !admin;
}

function bindTabs() {
  $("#organize-tab").addEventListener("click", () => switchMode("organize"));
  $("#reveal-tab").addEventListener("click", () => switchMode("reveal"));
}

function switchMode(mode) {
  const organize = mode === "organize";
  organizerPanel.hidden = !organize;
  revealPanel.hidden = organize;
  successPanel.hidden = true;
  recoveryPanel.hidden = true;
  $("#organize-tab").classList.toggle("active", organize);
  $("#organize-tab").setAttribute("aria-selected", String(organize));
  $("#reveal-tab").classList.toggle("active", !organize);
  $("#reveal-tab").setAttribute("aria-selected", String(!organize));
  if (!organize) configureRevealPanel();
}

function bindOrganizer() {
  $("#add-person").addEventListener("click", () => {
    state.participants.push("");
    renderParticipants();
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll(".participant-name");
      inputs[inputs.length - 1].focus();
    });
  });

  $("#add-exclusion").addEventListener("click", () => {
    const giver = $("#exclusion-giver").value;
    const recipient = $("#exclusion-recipient").value;
    if (!giver || !recipient || giver === recipient) {
      showMessage(organizerMessage, "Choose two different participants.");
      return;
    }
    if (!state.exclusions.some((item) => item.giver === giver && item.recipient === recipient)) {
      state.exclusions.push({ giver, recipient });
    }
    hideMessage(organizerMessage);
    renderExclusions();
  });

  $("#organizer-form").addEventListener("submit", createExchange);
}

function renderParticipants() {
  const list = $("#participant-list");
  list.replaceChildren();
  state.participants.forEach((name, index) => {
    const row = document.createElement("div");
    row.className = "participant-row";
    row.innerHTML = `
      <span class="person-number">${String(index + 1).padStart(2, "0")}</span>
      <input class="participant-name" aria-label="Participant ${index + 1} first name"
        autocomplete="off" maxlength="40" placeholder="First name" value="${escapeAttribute(name)}" required />
      <button class="remove-person" type="button" aria-label="Remove participant ${index + 1}">×</button>
    `;
    row.querySelector("input").addEventListener("input", (event) => {
      state.participants[index] = event.target.value;
      pruneExclusions();
      renderExclusionOptions();
    });
    row.querySelector("button").addEventListener("click", () => {
      if (state.participants.length <= 2) {
        showMessage(organizerMessage, "An exchange needs at least two people.");
        return;
      }
      state.participants.splice(index, 1);
      pruneExclusions();
      renderParticipants();
    });
    list.append(row);
  });
  $("#participant-count").textContent =
    `${state.participants.length} ${state.participants.length === 1 ? "person" : "people"}`;
  renderExclusionOptions();
  renderExclusions();
}

function renderExclusionOptions() {
  const names = state.participants.map((name) => name.trim()).filter(Boolean);
  for (const selector of ["#exclusion-giver", "#exclusion-recipient"]) {
    const select = $(selector);
    const previous = select.value;
    select.innerHTML = `<option value="">Select a person</option>`;
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    }
    if (names.includes(previous)) select.value = previous;
  }
}

function pruneExclusions() {
  const names = new Set(state.participants.map((name) => name.trim()));
  state.exclusions = state.exclusions.filter(
    ({ giver, recipient }) => names.has(giver) && names.has(recipient),
  );
}

function renderExclusions() {
  const list = $("#exclusion-list");
  list.replaceChildren();
  state.exclusions.forEach((exclusion, index) => {
    const chip = document.createElement("span");
    chip.className = "exclusion-chip";
    chip.append(document.createTextNode(`${exclusion.giver} → ${exclusion.recipient}`));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove exclusion ${exclusion.giver} to ${exclusion.recipient}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.exclusions.splice(index, 1);
      renderExclusions();
    });
    chip.append(remove);
    list.append(chip);
  });
}

async function createExchange(event) {
  event.preventDefault();
  const submit = event.submitter;
  setLoading(submit, true, "Creating a valid circle…");
  hideMessage(organizerMessage);

  try {
    const result = await api("/api/exchanges", {
      method: "POST",
      body: JSON.stringify({
        participants: state.participants,
        exclusions: state.exclusions,
      }),
    });
    saveAdminRun({
      exchangeId: result.exchangeId,
      adminToken: result.adminToken,
      createdAt: result.createdAt,
      participantCount: result.credentials.length,
    });
    state.exchangeId = result.exchangeId;
    history.replaceState({}, "", `?exchange=${encodeURIComponent(result.exchangeId)}`);
    showOrganizerSuccess(result);
  } catch (error) {
    showMessage(organizerMessage, error.message);
  } finally {
    setLoading(submit, false);
  }
}

function showOrganizerSuccess(result) {
  organizerPanel.hidden = true;
  revealPanel.hidden = true;
  successPanel.hidden = false;
  resetControl.hidden = false;
  successPanel.innerHTML = `
    <div class="success-seal" aria-hidden="true">✓</div>
    <p class="step-label">Circle complete</p>
    <h2>Your exchange is ready</h2>
    <p class="panel-intro">Send each person their private name + PIN combination. The giving order is never displayed.</p>
    <div class="credential-grid">
      ${result.credentials
        .map(
          ({ name, pin }) => `
            <div class="credential"><span>${escapeHtml(name)}</span><strong>${pin}</strong></div>
          `,
        )
        .join("")}
    </div>
    <p class="step-label">Participant link</p>
    <div class="share-box">
      <input id="share-link" readonly value="${escapeAttribute(result.participantUrl)}" aria-label="Participant link" />
      <button id="copy-link" type="button">Copy</button>
    </div>
    <button class="primary-button" id="open-reveal" type="button"><span>Open participant view</span><span>→</span></button>
  `;
  $("#copy-link").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(result.participantUrl);
    event.currentTarget.textContent = "Copied";
  });
  $("#open-reveal").addEventListener("click", () => switchMode("reveal"));
  successPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindReveal() {
  $("#exchange-code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    const exchangeId = extractExchangeId($("#exchange-code").value);
    if (!exchangeId) {
      showMessage(exchangeCodeMessage, "Enter a valid participant link or exchange code.");
      return;
    }

    setLoading(submit, true, "Checking exchange…");
    hideMessage(exchangeCodeMessage);
    try {
      await api(`/api/exchanges/${encodeURIComponent(exchangeId)}`, { method: "GET" });
      state.exchangeId = exchangeId;
      const url = new URL(location.href);
      url.searchParams.set("exchange", exchangeId);
      history.replaceState({}, "", url);
      configureRevealPanel();
      $("#reveal-name").focus();
    } catch (error) {
      showMessage(exchangeCodeMessage, error.message);
    } finally {
      setLoading(submit, false);
    }
  });

  $("#reveal-pin").addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
  });
  $("#reveal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    setLoading(submit, true, "Checking…");
    hideMessage(revealMessage);
    try {
      const result = await api("/api/reveal", {
        method: "POST",
        body: JSON.stringify({
          exchangeId: state.exchangeId,
          name: $("#reveal-name").value,
          pin: $("#reveal-pin").value,
        }),
      });
      showRevealSuccess(result.recipient);
    } catch (error) {
      showMessage(revealMessage, error.message);
    } finally {
      setLoading(submit, false);
    }
  });
}

function configureRevealPanel() {
  const hasExchange = Boolean(state.exchangeId);
  $("#exchange-code-form").hidden = hasExchange;
  $("#reveal-form").hidden = !hasExchange;
  $("#reveal-heading").textContent = hasExchange ? "Who are you gifting?" : "Find your exchange";
  $("#reveal-intro").textContent = hasExchange
    ? "Use the exact first name and PIN your organizer sent you."
    : "Paste the participant link or exchange code your organizer sent you.";
}

function extractExchangeId(value) {
  const input = value.trim();
  if (/^[a-zA-Z0-9_-]{8,64}$/.test(input)) return input;
  try {
    const parsed = new URL(input);
    const exchangeId = parsed.searchParams.get("exchange") || "";
    return /^[a-zA-Z0-9_-]{8,64}$/.test(exchangeId) ? exchangeId : "";
  } catch {
    return "";
  }
}

function showRevealSuccess(recipient) {
  revealPanel.hidden = true;
  successPanel.hidden = false;
  successPanel.innerHTML = `
    <div class="success-seal" aria-hidden="true">✦</div>
    <p class="step-label">Keep it secret</p>
    <h2>Your person is…</h2>
    <div class="recipient-card">
      <p>You’re giving to</p>
      <h3>${escapeHtml(recipient)}</h3>
    </div>
    <p class="panel-intro">Make their season bright—and remember, no spoilers.</p>
    <button class="secondary-button" id="hide-result" type="button">Hide this result</button>
  `;
  $("#hide-result").addEventListener("click", () => {
    $("#reveal-form").reset();
    switchMode("reveal");
  });
}

function bindReset() {
  const dialog = $("#reset-dialog");
  const confirmation = $("#reset-confirmation");
  resetControl.addEventListener("click", () => {
    confirmation.value = "";
    $("#confirm-reset").disabled = true;
    dialog.showModal();
  });
  confirmation.addEventListener("input", () => {
    $("#confirm-reset").disabled = confirmation.value !== "RESET";
  });
  dialog.addEventListener("close", async () => {
    if (dialog.returnValue !== "default" || confirmation.value !== "RESET") return;
    const run = getAdminRuns().find((item) => item.exchangeId === state.exchangeId);
    if (!run) return;
    try {
      await adminApi(run, "reset");
      resetControl.hidden = true;
      switchMode("reveal");
      showMessage(revealMessage, "This exchange has been reset. Its original assignments remain recoverable.");
    } catch (error) {
      showMessage(revealMessage, error.message);
    }
  });
}

async function showRecovery() {
  organizerPanel.hidden = true;
  revealPanel.hidden = true;
  successPanel.hidden = true;
  recoveryPanel.hidden = false;
  $(".mode-tabs").hidden = true;
  resetControl.hidden = true;
  recoveryPanel.innerHTML = `
    <p class="step-label">Private recovery</p>
    <h2>Exchange archive</h2>
    <p class="panel-intro">Only exchanges created in this browser appear here. Assignments and PINs are never displayed.</p>
    <div class="recovery-list"><p>Loading saved exchanges…</p></div>
  `;

  const runs = getAdminRuns();
  const statuses = await Promise.all(
    runs.map(async (run) => {
      try {
        return { run, status: await adminApi(run, "status") };
      } catch {
        return null;
      }
    }),
  );
  const list = $(".recovery-list");
  list.replaceChildren();
  const available = statuses.filter(Boolean);
  if (!available.length) {
    list.innerHTML = "<p>No recoverable exchanges were found in this browser.</p>";
    return;
  }

  for (const { run, status } of available) {
    const item = document.createElement("div");
    item.className = "recovery-item";
    item.innerHTML = `
      <div><strong>${status.participantCount} participants</strong>
      <p>Created ${formatDate(status.createdAt)} · ${status.status}</p></div>
    `;
    if (status.status === "reset") {
      const restore = document.createElement("button");
      restore.className = "secondary-button";
      restore.type = "button";
      restore.textContent = "Restore";
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        try {
          await adminApi(run, "restore");
          restore.textContent = "Restored";
        } catch (error) {
          restore.disabled = false;
          restore.textContent = error.message;
        }
      });
      item.append(restore);
    }
    list.append(item);
  }
}

async function adminApi(run, action) {
  const path =
    action === "status"
      ? `/api/exchanges/${encodeURIComponent(run.exchangeId)}/admin`
      : `/api/exchanges/${encodeURIComponent(run.exchangeId)}/${action}`;
  return api(path, {
    method: action === "status" ? "GET" : "POST",
    headers: { authorization: `Bearer ${run.adminToken}` },
  });
}

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
  return body;
}

function getAdminRuns() {
  try {
    return JSON.parse(localStorage.getItem("secret-santa-admin-runs") || "[]");
  } catch {
    return [];
  }
}

function saveAdminRun(run) {
  const runs = getAdminRuns().filter((item) => item.exchangeId !== run.exchangeId);
  localStorage.setItem("secret-santa-admin-runs", JSON.stringify([run, ...runs]));
}

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function hideMessage(element) {
  element.hidden = true;
}

function setLoading(button, loading, text) {
  if (loading) {
    button.dataset.label = button.querySelector("span")?.textContent || button.textContent;
    const label = button.querySelector("span");
    if (label) label.textContent = text;
    else button.textContent = text;
  } else {
    const label = button.querySelector("span");
    if (label) label.textContent = button.dataset.label;
    else button.textContent = button.dataset.label;
  }
  button.disabled = loading;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
