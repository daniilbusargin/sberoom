/*
 * Sberoom — mock data layer.
 * In production the employee roster and attendance history would come from
 * an HR system / Excel import. Here we generate them deterministically so
 * the demo shows realistic numbers near the current 50/50 baseline.
 */

const TODAY = '2026-06-02';      // Tuesday, June 2 2026
const CURRENT_USER_ID = 'emp-1'; // Demo user

const TARGET_REMOTE_SHARE = 0.30;  // 30 % remote
const MAX_FORWARD_DAYS = 3;        // user can plan up to 3 days ahead

const TEAMS = [
  { id: 'platform',  name: 'Платформа' },
  { id: 'analytics', name: 'Аналитика' },
  { id: 'product',   name: 'Продукт' },
  { id: 'design',    name: 'Дизайн' },
  { id: 'infra',     name: 'Инфраструктура' },
];

const POSITIONS = [
  'Разработчик', 'Старший разработчик', 'Ведущий разработчик',
  'Аналитик', 'Старший аналитик',
  'Менеджер продукта', 'Тимлид', 'Дизайнер',
  'Тестировщик', 'Архитектор', 'DevOps-инженер',
];

const FIRST_NAMES = [
  'Анна','Мария','Ольга','Елена','Татьяна','Ирина','Наталья','Светлана','Юлия','Дарья',
  'Александр','Дмитрий','Сергей','Андрей','Михаил','Иван','Алексей','Николай','Павел','Артём',
  'Екатерина','Виктория','Полина','София','Алина','Кристина','Валерия','Маргарита','Ксения','Алиса',
  'Кирилл','Максим','Егор','Никита','Тимур','Роман','Денис','Илья','Владимир','Антон',
];

const LAST_NAMES = [
  'Иванов','Петров','Смирнов','Кузнецов','Соколов','Попов','Лебедев','Козлов','Новиков','Морозов',
  'Волков','Соловьёв','Васильев','Зайцев','Павлов','Семёнов','Голубев','Виноградов','Богданов','Воробьёв',
  'Фёдоров','Михайлов','Беляев','Тарасов','Белов','Комаров','Орлов','Киселёв','Макаров','Андреев',
  'Ковалёв','Ильин','Гусев','Титов','Кузьмин','Кудрявцев','Баранов','Куликов','Алексеев','Степанов',
];

const TEAM_SIZE = {
  platform:  22,
  analytics: 18,
  product:   16,
  infra:     14,
  design:    10,
};

/* ── deterministic RNG ─────────────────────────────────────────── */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── employees ─────────────────────────────────────────────────── */
const EMPLOYEES = (function buildEmployees() {
  const rng = mulberry32(42);
  const list = [];
  let n = 1;
  for (const team of TEAMS) {
    const size = TEAM_SIZE[team.id];
    for (let i = 0; i < size; i++) {
      const gender = rng() < 0.5 ? 'm' : 'f';
      const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
      let last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      if (gender === 'f' && /[^а]$/.test(last)) last += 'а';
      const pos = POSITIONS[Math.floor(rng() * POSITIONS.length)];
      list.push({
        id: `emp-${n}`,
        name: `${first} ${last}`,
        team: team.id,
        position: pos,
      });
      n++;
    }
  }
  // Force the demo user identity.
  list[0] = { id: 'emp-1', name: 'Вы (Алексей К.)', team: 'platform', position: 'Старший разработчик' };
  return list;
})();

const EMPLOYEES_BY_ID = Object.fromEntries(EMPLOYEES.map(e => [e.id, e]));

/* ── date helpers ──────────────────────────────────────────────── */
function parseDate(s) {                       // 'YYYY-MM-DD' → Date (local)
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
function isWeekend(s) { const d = parseDate(s).getDay(); return d === 0 || d === 6; }
function isWorkingDay(s) { return !isWeekend(s); }
function compareDates(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/* List working days of the month containing `anchor`. */
function workingDaysOfMonth(anchor) {
  const d = parseDate(anchor);
  const y = d.getFullYear(), m = d.getMonth();
  const out = [];
  const cur = new Date(y, m, 1);
  while (cur.getMonth() === m) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) out.push(fmtDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/* ── generated attendance ──────────────────────────────────────── */
/*
 * For every working day up to and including TODAY we generate an office /
 * remote status per employee, biased so the overall remote share averages
 * around 50 % (matching the current baseline mentioned in the brief).
 * Some employees also pre-plan one or two days in the future.
 */
const GENERATED_ATTENDANCE = (function () {
  const map = {};                                       // empId → { date: status }
  EMPLOYEES.forEach(e => { map[e.id] = {}; });

  // Personal remote-affinity per employee, slightly clustered by team.
  const teamBias = { platform: 0.55, analytics: 0.50, product: 0.42, design: 0.48, infra: 0.40 };
  const personalBias = {};
  const rng = mulberry32(101);
  for (const e of EMPLOYEES) {
    const base = teamBias[e.team] ?? 0.5;
    personalBias[e.id] = Math.min(0.85, Math.max(0.1, base + (rng() - 0.5) * 0.3));
  }

  // Past + today: fill working days from the 1st up to and including TODAY.
  const monthDays = workingDaysOfMonth(TODAY);
  const past = monthDays.filter(d => d <= TODAY);
  for (const date of past) {
    const dRng = mulberry32(hash(date));
    for (const e of EMPLOYEES) {
      // Slight weekly seasonality: Mondays / Fridays a touch more remote.
      const wd = parseDate(date).getDay();
      const seasonal = (wd === 1 || wd === 5) ? 0.06 : 0;
      const p = personalBias[e.id] + seasonal;
      // Most people log a status; ~5 % don't (vacation, sick, etc.).
      if (dRng() < 0.05) continue;
      map[e.id][date] = dRng() < p ? 'remote' : 'office';
    }
  }
  // Today: leave the current user blank so they're prompted to choose.
  delete map[CURRENT_USER_ID][TODAY];

  // Future: a portion of employees pre-plan 1–3 of the next working days.
  for (let i = 1; i <= 5; i++) {
    const date = addDays(TODAY, i);
    if (!isWorkingDay(date)) continue;
    const dRng = mulberry32(hash(date) ^ 0xA5A5);
    for (const e of EMPLOYEES) {
      if (e.id === CURRENT_USER_ID) continue;
      if (dRng() < 0.35) {                              // 35 % planned ahead
        const wd = parseDate(date).getDay();
        const seasonal = (wd === 1 || wd === 5) ? 0.06 : 0;
        const p = personalBias[e.id] + seasonal;
        map[e.id][date] = dRng() < p ? 'remote' : 'office';
      }
    }
  }
  return map;
})();

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ── previous-month aggregate (for delta) ──────────────────────── */
const PREV_MONTH_REMOTE_SHARE = 0.48;   // “May” baseline used to compute deltas

/* ── gamification copy ─────────────────────────────────────────── */
const GAMIFICATION_LINES = [
  'Точно удалённо? Коллеги уже ждут тебя в офисе ☕',
  'Сегодня в офисе намечается хороший день 👀',
  'Ещё один день в офисе поможет команде приблизиться к цели 🎯',
  'Кофемашина уже скучает ☕',
  'Завтра обещают пироги на кухне 🥧',
  'Командные обсуждения в офисе проходят живее 💬',
  'Хорошего удалённого дня! Не забудь сделать перерыв 🌿',
];

const REMOTE_REASONS = [
  { id: '',         label: '— не указывать' },
  { id: 'planned',  label: 'Плановая удалённая работа' },
  { id: 'force',    label: 'Форс-мажор / личные обстоятельства' },
];

/* ── exports (attach to window for plain-script consumption) ───── */
window.SBR = {
  TODAY, CURRENT_USER_ID, TARGET_REMOTE_SHARE, MAX_FORWARD_DAYS,
  TEAMS, EMPLOYEES, EMPLOYEES_BY_ID,
  GENERATED_ATTENDANCE, PREV_MONTH_REMOTE_SHARE,
  GAMIFICATION_LINES, REMOTE_REASONS,
  parseDate, fmtDate, addDays, isWeekend, isWorkingDay,
  workingDaysOfMonth, compareDates,
};
