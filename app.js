/*
 * Sberoom — application logic. Renders the four tabs (Сводка / Календарь /
 * Команды / Я), computes KPIs against the 70/30 target, and persists the
 * current user's own attendance choices to localStorage.
 */
(function () {
  const S = window.SBR;
  const STORAGE_KEY = 'sberoom_user_v1';

  /* ── persistence: user's own overrides ─────────────────────── */
  function loadOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function saveOverrides(map) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
  }
  let userOverrides = loadOverrides();   // { 'YYYY-MM-DD': { status, reason } }

  /* ── attendance lookup ─────────────────────────────────────── */
  function getStatus(empId, date) {
    if (empId === S.CURRENT_USER_ID && userOverrides[date]) {
      return userOverrides[date].status;
    }
    return S.GENERATED_ATTENDANCE[empId]?.[date];
  }
  function setUserStatus(date, status, reason) {
    if (!status) delete userOverrides[date];
    else userOverrides[date] = { status, reason: reason || '' };
    saveOverrides(userOverrides);
  }

  /* ── stats ─────────────────────────────────────────────────── */
  function dayCounts(date, employees) {
    const list = employees || S.EMPLOYEES;
    let office = 0, remote = 0, none = 0;
    for (const e of list) {
      const st = getStatus(e.id, date);
      if (st === 'office') office++;
      else if (st === 'remote') remote++;
      else none++;
    }
    const counted = office + remote;
    const remoteShare = counted ? remote / counted : 0;
    return { office, remote, none, counted, total: list.length, remoteShare };
  }

  function monthRemoteShare(employees) {
    const days = S.workingDaysOfMonth(S.TODAY).filter(d => d <= S.TODAY);
    let r = 0, c = 0;
    for (const d of days) {
      const s = dayCounts(d, employees);
      r += s.remote; c += s.counted;
    }
    return { share: c ? r / c : 0, remoteDays: r, countedDays: c, daysObserved: days.length };
  }

  function forecastMonthShare() {
    // Take current month-to-date share; extrapolate by giving remaining
    // (unfilled) working days the same share. Equivalent to using the MTD
    // share as the forecast.
    return monthRemoteShare().share;
  }

  /* ── color zones (remote share → state) ────────────────────── */
  function zone(share) {
    const pct = share * 100;
    if (pct <= 30) return { key: 'green',  emoji: '🟢', label: 'В целевой зоне' };
    if (pct <= 35) return { key: 'yellow', emoji: '🟡', label: 'Близко к норме' };
    if (pct <= 40) return { key: 'orange', emoji: '🟠', label: 'Выше целевого' };
    return            { key: 'red',    emoji: '🔴', label: 'Существенно выше цели' };
  }

  /* ── formatting ────────────────────────────────────────────── */
  const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const MONTHS_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const WEEKDAYS_SHORT = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
  function pct(x, digits) { return `${(x * 100).toFixed(digits ?? 0)}%`; }
  function pctSigned(x) {
    const v = x * 100;
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    return `${sign}${Math.abs(v).toFixed(1)} п.п.`;
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* ── views ─────────────────────────────────────────────────── */
  const root = document.getElementById('view');
  let currentView = 'home';

  function setView(name) {
    currentView = name;
    document.querySelectorAll('.tabbar__btn').forEach(b => {
      b.setAttribute('aria-current', b.dataset.view === name ? 'true' : 'false');
    });
    render();
  }

  function render() {
    root.innerHTML = '';
    if (currentView === 'home')     renderHome();
    else if (currentView === 'calendar') renderCalendar();
    else if (currentView === 'teams') renderTeams();
    else if (currentView === 'me')    renderMe();
    root.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  /* ── HOME ──────────────────────────────────────────────────── */
  function renderHome() {
    const todayCounts = dayCounts(S.TODAY);
    const month = monthRemoteShare();
    const z = zone(month.share);
    const forecast = forecastMonthShare();
    const monthName = MONTHS_NOM[S.parseDate(S.TODAY).getMonth()];
    const delta = month.share - S.PREV_MONTH_REMOTE_SHARE;
    const officeShare = 1 - month.share;
    const officeTarget = 1 - S.TARGET_REMOTE_SHARE;
    const officeDelta = officeShare - officeTarget;

    // Hero indicator (full-width on desktop)
    const hero = el(`
      <section class="view__full">
        <div class="indicator indicator--${z.key}">
          <div class="indicator__emoji">${z.emoji}</div>
          <div class="indicator__label">Удалёнка в ${MONTHS[S.parseDate(S.TODAY).getMonth()]}</div>
          <div class="indicator__value">
            <span class="indicator__num">${(month.share * 100).toFixed(0)}</span>
            <span class="indicator__pct">%</span>
          </div>
          <div class="indicator__bar" aria-hidden="true">
            <div class="indicator__bar-fill" style="width: ${Math.min(100, month.share * 100).toFixed(1)}%"></div>
            <div class="indicator__bar-target" style="left: ${S.TARGET_REMOTE_SHARE * 100}%" title="Цель 30 %"></div>
          </div>
          <div class="indicator__footnote">
            <span>Цель — не более 30 % удалёнки</span>
            <span>${escapeHTML(z.label)}</span>
          </div>
        </div>
      </section>
    `);
    root.appendChild(hero);

    // Сегодня
    root.appendChild(el(`
      <section class="card">
        <h3 class="card__title">Сегодня · ${formatHumanDate(S.TODAY)}</h3>
        <div class="today">
          <div class="today__cell">
            <div class="today__cell-label">В офисе</div>
            <div class="today__cell-value"><span class="today__cell-icon">🏢</span>${todayCounts.office}</div>
          </div>
          <div class="today__cell">
            <div class="today__cell-label">Удалённо</div>
            <div class="today__cell-value"><span class="today__cell-icon">🏠</span>${todayCounts.remote}</div>
          </div>
          <div class="today__cell">
            <div class="today__cell-label">Доля удалёнки</div>
            <div class="today__cell-value">${pct(todayCounts.remoteShare)}</div>
          </div>
        </div>
        <p class="card__subtle" style="margin: 10px 0 0">
          Учтены ${todayCounts.counted} из ${todayCounts.total} сотрудников. Не отметились: ${todayCounts.none}.
        </p>
      </section>
    `));

    // KPI
    root.appendChild(el(`
      <section class="card">
        <h3 class="card__title">KPI за ${monthName.toLowerCase()}</h3>
        <div class="kpis">
          <div class="kpi">
            <div class="kpi__label">Удалёнка ↘</div>
            <div class="kpi__value">${pct(month.share, 1)}</div>
            <div class="kpi__delta ${delta < 0 ? 'kpi__delta--good' : delta > 0 ? 'kpi__delta--bad' : ''}">
              ${pctSigned(delta)} к маю
            </div>
          </div>
          <div class="kpi">
            <div class="kpi__label">Офис ↗</div>
            <div class="kpi__value">${pct(officeShare, 1)}</div>
            <div class="kpi__delta ${officeDelta > 0 ? 'kpi__delta--good' : officeDelta < 0 ? 'kpi__delta--bad' : ''}">
              цель ${pct(officeTarget)} (${pctSigned(officeDelta)})
            </div>
          </div>
          <div class="kpi">
            <div class="kpi__label">Учтённых дней</div>
            <div class="kpi__value">${month.daysObserved}</div>
            <div class="kpi__delta">из ${S.workingDaysOfMonth(S.TODAY).length} рабочих в месяце</div>
          </div>
          <div class="kpi">
            <div class="kpi__label">Целевой показатель</div>
            <div class="kpi__value">${zone(month.share).key === 'green' ? '✓ выполнен' : 'не выполнен'}</div>
            <div class="kpi__delta">70 % офис / 30 % удалёнка</div>
          </div>
        </div>
      </section>
    `));

    // Прогноз
    root.appendChild(el(`
      <section class="card">
        <h3 class="card__title">Прогноз месяца</h3>
        <div class="forecast">
          <div class="forecast__icon">🔮</div>
          <div class="forecast__text">
            Если текущая динамика сохранится, итоговая доля удалённой работы
            за ${monthName.toLowerCase()} составит
            <span class="forecast__value">${pct(forecast, 0)}</span>.
            ${forecast > S.TARGET_REMOTE_SHARE
              ? `Это выше целевого значения 30 %. Постепенный сдвиг в офис поможет команде вернуться к цели.`
              : `Это в пределах целевого значения 30 %. Хорошая динамика — так держать.`}
          </div>
        </div>
      </section>
    `));

    // Ближайшие 4 дня — CTA
    const myUpcoming = nextPlannableDates().map(d => ({
      date: d, status: getStatus(S.CURRENT_USER_ID, d),
    }));
    const cta = el(`
      <section class="card view__full">
        <h3 class="card__title">Ваши ближайшие дни</h3>
        <div class="cal-days" id="home-mini"></div>
        <button class="btn btn--ghost" id="cta-cal" style="margin-top:12px">Открыть календарь</button>
      </section>
    `);
    const mini = cta.querySelector('#home-mini');
    myUpcoming.slice(0, 4).forEach(d => mini.appendChild(buildDayRow(d.date, d.status, false)));
    cta.querySelector('#cta-cal').addEventListener('click', () => setView('calendar'));
    root.appendChild(cta);
  }

  /* ── CALENDAR ──────────────────────────────────────────────── */
  function renderCalendar() {
    root.appendChild(el(`
      <section class="card view__full">
        <h3 class="card__title">Календарь</h3>
        <p class="card__subtle" style="margin: 0 0 12px">
          Отметьте формат работы на сегодня и до ${S.MAX_FORWARD_DAYS} рабочих дней вперёд.
        </p>
        <div class="cal-days" id="cal-list"></div>
      </section>
    `));
    const list = document.getElementById('cal-list');
    for (const d of nextPlannableDates()) {
      const status = getStatus(S.CURRENT_USER_ID, d);
      list.appendChild(buildDayRow(d, status, false));
    }

    // Recent history (last 7 working days incl. today)
    root.appendChild(el(`
      <section class="card view__full">
        <h3 class="card__title">Недавние дни</h3>
        <div class="cal-days" id="cal-past"></div>
      </section>
    `));
    const pastList = document.getElementById('cal-past');
    const past = S.workingDaysOfMonth(S.TODAY).filter(d => d <= S.TODAY).slice(-7).reverse();
    for (const d of past) {
      const status = getStatus(S.CURRENT_USER_ID, d);
      pastList.appendChild(buildDayRow(d, status, true));
    }
  }

  function nextPlannableDates() {
    // Today + next MAX_FORWARD_DAYS calendar days, skip weekends.
    const out = [];
    if (S.isWorkingDay(S.TODAY)) out.push(S.TODAY);
    let i = 1;
    while (out.length < 1 + S.MAX_FORWARD_DAYS && i < 10) {
      const d = S.addDays(S.TODAY, i);
      if (S.isWorkingDay(d)) out.push(d);
      i++;
    }
    return out;
  }

  function buildDayRow(date, status, isPast) {
    const d = S.parseDate(date);
    const today = date === S.TODAY;
    const weekend = S.isWeekend(date);
    const row = el(`
      <div class="cal-day ${isPast ? 'cal-day--past' : ''} ${weekend ? 'cal-day--weekend cal-day--locked' : ''}">
        <div class="cal-day__date">
          <div class="cal-day__weekday">${WEEKDAYS_SHORT[d.getDay()]}${today ? ' · сегодня' : ''}</div>
          <div class="cal-day__num">${d.getDate()} ${MONTHS[d.getMonth()]}</div>
          <div class="cal-day__hint">${dayHint(date, status, isPast)}</div>
        </div>
        <div class="cal-day__actions">
          <button class="cal-btn cal-btn--office ${status === 'office' ? 'cal-btn--active' : ''}" data-st="office" ${weekend ? 'disabled' : ''}>
            <span class="cal-btn__icon">🏢</span><span>Офис</span>
          </button>
          <button class="cal-btn cal-btn--remote ${status === 'remote' ? 'cal-btn--active' : ''}" data-st="remote" ${weekend ? 'disabled' : ''}>
            <span class="cal-btn__icon">🏠</span><span>Удалённо</span>
          </button>
        </div>
      </div>
    `);
    if (!isPast && !weekend) {
      row.querySelector('[data-st="office"]').addEventListener('click', () => onPickOffice(date));
      row.querySelector('[data-st="remote"]').addEventListener('click', () => onPickRemote(date));
    }
    return row;
  }

  function dayHint(date, status, isPast) {
    if (S.isWeekend(date)) return 'Выходной';
    if (status === 'office') return '🏢 Офис';
    if (status === 'remote') return '🏠 Удалённо';
    return isPast ? '⏳ Не было отметки' : '⏳ Формат не выбран';
  }

  /* ── interactions ──────────────────────────────────────────── */
  function onPickOffice(date) {
    setUserStatus(date, 'office');
    toast('🏢 Отмечено: офис');
    render();
  }
  function onPickRemote(date) {
    showRemoteModal(date);
  }

  /* ── modal ─────────────────────────────────────────────────── */
  function showRemoteModal(date) {
    const modalRoot = document.getElementById('modal-root');
    const before = dayCounts(date);
    const myCurrent = getStatus(S.CURRENT_USER_ID, date);

    // Compute the after-pick share.
    const afterRemote = before.remote + (myCurrent === 'remote' ? 0 : 1);
    const afterOffice = before.office - (myCurrent === 'office' ? 1 : 0);
    const afterCounted = afterRemote + afterOffice;
    const afterShare = afterCounted ? afterRemote / afterCounted : 0;

    const team = S.EMPLOYEES_BY_ID[S.CURRENT_USER_ID].team;
    const teamList = S.EMPLOYEES.filter(e => e.team === team);
    const teamCounts = dayCounts(date, teamList);

    const z = zone(afterShare);
    const game = S.GAMIFICATION_LINES[Math.floor(Math.random() * S.GAMIFICATION_LINES.length)];
    const reasons = S.REMOTE_REASONS.map(r => `<option value="${r.id}">${escapeHTML(r.label)}</option>`).join('');

    modalRoot.hidden = false;
    modalRoot.innerHTML = '';
    const modal = el(`
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
        <div class="modal__handle" aria-hidden="true"></div>
        <h2 class="modal__title" id="mt">Выбрать удалённый день</h2>
        <p class="modal__sub">${formatHumanDate(date)}</p>

        <div class="modal__stat">
          <span class="modal__stat-icon">🏠</span>
          <span>Сейчас удалённо работает <strong>${pct(before.remoteShare)}</strong> сотрудников.</span>
        </div>
        <div class="modal__stat">
          <span class="modal__stat-icon">➡️</span>
          <span>После вашего выбора доля удалёнки составит <strong>${pct(afterShare)}</strong>.</span>
        </div>
        <div class="modal__stat">
          <span class="modal__stat-icon">👥</span>
          <span>В вашей команде удалёнка сегодня — <strong>${pct(teamCounts.remoteShare)}</strong>.</span>
        </div>

        ${afterShare > S.TARGET_REMOTE_SHARE ? `
          <div class="modal__warning">
            Сейчас доля удалённой работы превышает целевое значение 30 %.
            Если превышение будет сохраняться длительное время, в будущем могут быть
            введены дополнительные механики регулирования.
          </div>` : ''}

        <div class="modal__game">${escapeHTML(game)}</div>

        <div class="modal__field">
          <label for="reason">Причина (необязательно)</label>
          <select id="reason">${reasons}</select>
        </div>

        <div class="modal__actions">
          <button class="btn btn--ghost" id="m-cancel">Отмена</button>
          <button class="btn btn--primary" id="m-ok">Подтвердить</button>
        </div>
      </div>
    `);
    modalRoot.appendChild(modal);

    const close = () => { modalRoot.hidden = true; modalRoot.innerHTML = ''; };
    modal.querySelector('#m-cancel').addEventListener('click', close);
    modalRoot.addEventListener('click', e => { if (e.target === modalRoot) close(); }, { once: true });
    modal.querySelector('#m-ok').addEventListener('click', () => {
      const reason = modal.querySelector('#reason').value;
      setUserStatus(date, 'remote', reason);
      close();
      toast('🏠 Отмечено: удалённо');
      render();
    });
  }

  /* ── TEAMS ─────────────────────────────────────────────────── */
  function renderTeams() {
    const monthOverall = monthRemoteShare();
    const z = zone(monthOverall.share);
    root.appendChild(el(`
      <section class="card view__full">
        <h3 class="card__title">Подразделение в целом</h3>
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
          <div>
            <div style="font-size:32px;font-weight:800;letter-spacing:-0.02em">${pct(monthOverall.share, 0)}</div>
            <div class="card__subtle">удалёнка · цель 30 %</div>
          </div>
          <div class="team-row__pct ${z.key === 'green' ? 'team-row__pct--ok' : z.key === 'red' ? 'team-row__pct--miss' : 'team-row__pct--warn'}">
            ${z.emoji} ${escapeHTML(z.label)}
          </div>
        </div>
      </section>
    `));

    // Team rankings — by office presence share (descending)
    const rows = S.TEAMS.map(t => {
      const list = S.EMPLOYEES.filter(e => e.team === t.id);
      const m = monthRemoteShare(list);
      const officeShare = 1 - m.share;
      return { team: t, list, remoteShare: m.share, officeShare };
    }).sort((a, b) => b.officeShare - a.officeShare);

    const ranking = el(`
      <section class="card view__full">
        <h3 class="card__title">Рейтинг команд</h3>
        <p class="card__subtle" style="margin:0 0 8px">По доле присутствия в офисе за месяц. Без санкций — только для прозрачности.</p>
        <div id="team-rows"></div>
      </section>
    `);
    const list = ranking.querySelector('#team-rows');
    rows.forEach((r, i) => {
      const z = zone(r.remoteShare);
      const pctClass = z.key === 'green' ? 'team-row__pct--ok'
                    : z.key === 'red'   ? 'team-row__pct--miss'
                                        : 'team-row__pct--warn';
      const row = el(`
        <div class="team-row">
          <div class="team-row__rank">${i + 1}</div>
          <div>
            <div class="team-row__name">${escapeHTML(r.team.name)}</div>
            <div class="team-row__sub">${r.list.length} чел · удалёнка ${pct(r.remoteShare, 0)}</div>
            <div class="team-row__bar"><div class="team-row__bar-fill" style="width:${(r.officeShare * 100).toFixed(1)}%"></div></div>
          </div>
          <div class="team-row__pct ${pctClass}">${pct(r.officeShare, 0)}</div>
        </div>
      `);
      list.appendChild(row);
    });
    root.appendChild(ranking);
  }

  /* ── ME ────────────────────────────────────────────────────── */
  function renderMe() {
    const me = S.EMPLOYEES_BY_ID[S.CURRENT_USER_ID];
    const team = S.TEAMS.find(t => t.id === me.team);
    const monthDays = S.workingDaysOfMonth(S.TODAY).filter(d => d <= S.TODAY);
    let office = 0, remote = 0, none = 0;
    for (const d of monthDays) {
      const st = getStatus(me.id, d);
      if (st === 'office') office++;
      else if (st === 'remote') remote++;
      else none++;
    }
    const my = office + remote ? remote / (office + remote) : 0;

    // Last 7-day window
    const weekDays = monthDays.slice(-7);
    let wOffice = 0, wRemote = 0;
    for (const d of weekDays) {
      const st = getStatus(me.id, d);
      if (st === 'office') wOffice++;
      else if (st === 'remote') wRemote++;
    }

    root.appendChild(el(`
      <section class="card view__full">
        <h3 class="card__title">${escapeHTML(me.name)}</h3>
        <div class="card__subtle">${escapeHTML(me.position)} · ${escapeHTML(team.name)}</div>
      </section>
    `));

    root.appendChild(el(`
      <section class="card">
        <h3 class="card__title">Эта неделя</h3>
        <div class="streak">
          <div class="kpi">
            <div class="kpi__label">🏢 Офис</div>
            <div class="kpi__value">${wOffice}</div>
            <div class="kpi__delta">дней из ${weekDays.length}</div>
          </div>
          <div class="kpi">
            <div class="kpi__label">🏠 Удалёнка</div>
            <div class="kpi__value">${wRemote}</div>
            <div class="kpi__delta">дней из ${weekDays.length}</div>
          </div>
        </div>
      </section>
    `));

    root.appendChild(el(`
      <section class="card">
        <h3 class="card__title">Этот месяц</h3>
        <div class="streak">
          <div class="kpi">
            <div class="kpi__label">Доля удалёнки</div>
            <div class="kpi__value">${pct(my, 0)}</div>
            <div class="kpi__delta">${my <= S.TARGET_REMOTE_SHARE ? '✓ в пределах цели 30 %' : 'выше цели 30 %'}</div>
          </div>
          <div class="kpi">
            <div class="kpi__label">Отметок</div>
            <div class="kpi__value">${office + remote}</div>
            <div class="kpi__delta">пропущено: ${none}</div>
          </div>
        </div>
      </section>
    `));

    const histCard = el(`
      <section class="card view__full">
        <h3 class="card__title">История отметок</h3>
        <div class="history" id="history"></div>
      </section>
    `);
    const histList = histCard.querySelector('#history');
    [...monthDays].reverse().forEach(d => {
      const st = getStatus(me.id, d);
      const date = S.parseDate(d);
      const label = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
      const wd = WEEKDAYS_SHORT[date.getDay()];
      const cls = st === 'office' ? 'history__status--office'
                : st === 'remote' ? 'history__status--remote'
                                  : 'history__status--none';
      const text = st === 'office' ? '🏢 Офис'
                : st === 'remote' ? '🏠 Удалённо'
                                  : '— нет отметки';
      histList.appendChild(el(`
        <div class="history__row">
          <div class="history__date">${label}<small>${wd}${d === S.TODAY ? ' · сегодня' : ''}</small></div>
          <div class="history__status ${cls}">${text}</div>
        </div>
      `));
    });
    root.appendChild(histCard);
  }

  /* ── helpers ───────────────────────────────────────────────── */
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function formatHumanDate(date) {
    const d = S.parseDate(date);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS_SHORT[d.getDay()].toLowerCase()}`;
  }
  function toast(text) {
    const root = document.getElementById('toast-root');
    const node = el(`<div class="toast">${escapeHTML(text)}</div>`);
    root.appendChild(node);
    setTimeout(() => node.remove(), 2800);
  }

  /* ── user chip ─────────────────────────────────────────────── */
  function renderUserChip() {
    const me = S.EMPLOYEES_BY_ID[S.CURRENT_USER_ID];
    const team = S.TEAMS.find(t => t.id === me.team);
    const initials = me.name.split(/[ .]/).filter(Boolean).slice(0, 2).map(s => s[0]).join('');
    document.getElementById('user-chip').innerHTML = `
      <span class="user-chip__avatar">${escapeHTML(initials)}</span>
      <div style="min-width:0">
        <div class="user-chip__name">${escapeHTML(me.name)}</div>
        <div class="user-chip__team">${escapeHTML(team.name)}</div>
      </div>
    `;
  }

  /* ── boot ──────────────────────────────────────────────────── */
  document.querySelectorAll('.tabbar__btn').forEach(b => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });
  renderUserChip();
  setView('home');
})();
