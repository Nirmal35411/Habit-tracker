import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDocsFromCache,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock3,
  GripVertical,
  LogOut,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";

import { auth, db } from "./firebase";

/* =========================================================
   CONSTANTS
========================================================= */

const MAIN_DAYS = 30;
const DETAIL_DAYS = 90;

const HABITS_PATH = (uid) =>
  collection(db, "users", uid, "habits");

const HABIT_PATH = (uid, habitId) =>
  doc(db, "users", uid, "habits", habitId);

const RECORDS_PATH = (uid, habitId) =>
  collection(db, "users", uid, "habits", habitId, "records");

const RECORD_PATH = (uid, habitId, date) =>
  doc(
    db,
    "users",
    uid,
    "habits",
    habitId,
    "records",
    date
  );

/* =========================================================
   DATE HELPERS
========================================================= */

function dateKey(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function getDateRange(days) {
  const today = new Date();
  const result = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    result.push(dateKey(addDays(today, -i)));
  }

  return result;
}

function formatShortDate(key) {
  const date = parseDateKey(key);

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatLongDate(key) {
  const date = parseDateKey(key);

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonthYear(key) {
  const date = parseDateKey(key);

  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function isToday(key) {
  return key === dateKey();
}

/* =========================================================
   VALUE HELPERS
========================================================= */

function numericValue(record) {
  if (!record) return 0;

  const value = Number(record.value);

  return Number.isFinite(value) ? value : 0;
}

function isCompleted(habit, record) {
  if (!record) return false;

  if (habit.type === "boolean") {
    return record.value === true;
  }

  return (
    numericValue(record) >= Number(habit.referenceAmount || 0)
  );
}

function achievementPercent(habit, record) {
  if (!record) return 0;

  if (habit.type === "boolean") {
    return record.value === true ? 100 : 0;
  }

  const reference = Number(habit.referenceAmount);

  if (!reference || reference <= 0) return 0;

  return Math.max(
    0,
    (numericValue(record) / reference) * 100
  );
}

function clampedIntensity(habit, record) {
  return Math.min(100, achievementPercent(habit, record));
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "0";

  if (Number.isInteger(number)) {
    return String(number);
  }

  return number.toFixed(2).replace(/\.?0+$/, "");
}

/* =========================================================
   DAILY SCORE
   ---------------------------------------------------------
   A day score is stored once per day in
   users/{uid}/dailyScores/{YYYY-MM-DD}.

   It is only ever written for TODAY. Once the date has
   passed, nothing in the app writes to that day again, so
   later weight / reference / habit changes cannot alter it.
========================================================= */

const DAY_SCORES_PATH = (uid) =>
  collection(db, "users", uid, "dailyScores");

const DAY_SCORE_PATH = (uid, date) =>
  doc(db, "users", uid, "dailyScores", date);

function habitWeight(habit) {
  const weight = Number(habit.weight);

  return Number.isFinite(weight) && weight > 0
    ? weight
    : 1;
}

function roundScore(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;

  return Math.round(number * 100) / 100;
}

function formatScore(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "0";

  return String(Number(number.toFixed(1)));
}

function firstRecordKey(habit) {
  let first = null;

  for (const key of Object.keys(habit.records || {})) {
    if (first === null || key < first) first = key;
  }

  return first;
}

/*
 * score = sum(weight * completion%) / sum(weight)
 *
 * Boolean habits count as 0% or 100%.
 * Numeric habits use their exact % (capped at 100% so one
 * over-achieved habit can't hide a missed one).
 *
 * `starts` (optional Map habitId -> first record date) is used
 * only when back-filling old days: a habit counts for a past
 * day only if it already had history by then.
 *
 * Returns a number from 0 to 100, or null if no habit applies.
 */
function calculateDayScore(habits, key, starts = null) {
  let weighted = 0;
  let totalWeight = 0;

  for (const habit of habits) {
    if (starts) {
      const start = starts.get(habit.id);

      if (!start || start > key) continue;
    }

    const weight = habitWeight(habit);

    const percent = Math.min(
      100,
      achievementPercent(habit, habit.records[key])
    );

    weighted += weight * percent;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return null;

  return weighted / totalWeight;
}

async function loadDayScores(uid, source = "server") {
  const snapshot =
    source === "cache"
      ? await getDocsFromCache(DAY_SCORES_PATH(uid))
      : await getDocs(DAY_SCORES_PATH(uid));

  const scores = {};

  snapshot.forEach((scoreDoc) => {
    const value = Number(scoreDoc.data().score);

    if (Number.isFinite(value)) {
      scores[scoreDoc.id] = value;
    }
  });

  return scores;
}

const WEEKDAY_LABELS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

function scoreCellStyle(score) {
  const ratio = Math.min(
    1,
    Math.max(0, Number(score) / 100)
  );

  const alpha = 0.1 + ratio * 0.9;

  return {
    background: `rgba(22, 163, 74, ${alpha.toFixed(3)})`,
    color: alpha > 0.55 ? "#ffffff" : "#172033",
  };
}

function buildMonthList(firstKey, today) {
  const start = parseDateKey(firstKey);
  const end = parseDateKey(today);

  const list = [];

  let year = end.getFullYear();
  let month = end.getMonth();

  const startYear = start.getFullYear();
  const startMonth = start.getMonth();

  while (
    year > startYear ||
    (year === startYear && month >= startMonth)
  ) {
    list.push({ year, month });

    month -= 1;

    if (month < 0) {
      month = 11;
      year -= 1;
    }

    if (list.length > 1200) break;
  }

  return list;
}

/*
 * One month of the calendar.
 * getCell(key) returns null/undefined for "nothing", or:
 *   { intensity: 0-100, main: "text shown in the box", title }
 * A cell without `intensity` is drawn as an empty (no data) box.
 */
function MonthCalendar({
  year,
  month,
  today,
  getCell,
}) {
  const label = new Date(year, month, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" }
  );

  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];

  for (let i = 0; i < offset; i += 1) {
    cells.push({ pad: true, key: `pad-${i}` });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      pad: false,
      day,
      key: dateKey(new Date(year, month, day)),
    });
  }

  return (
    <div className="dt-month">
      <h3 className="dt-month-title">{label}</h3>

      <div className="dt-weekdays">
        {WEEKDAY_LABELS.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>

      <div className="dt-grid">
        {cells.map((cell) => {
          if (cell.pad) {
            return (
              <div
                key={cell.key}
                className="dt-cell dt-pad"
              />
            );
          }

          const info = getCell(cell.key);
          const hasData =
            info && info.intensity !== undefined;
          const future = cell.key > today;

          return (
            <div
              key={cell.key}
              className={`dt-cell ${
                hasData ? "dt-scored" : "dt-empty"
              } ${future ? "dt-future" : ""} ${
                cell.key === today ? "dt-today" : ""
              }`}
              style={
                hasData
                  ? scoreCellStyle(info.intensity)
                  : undefined
              }
              title={
                info?.title || formatLongDate(cell.key)
              }
            >
              <span className="dt-day-num">{cell.day}</span>

              {hasData &&
                info.main !== undefined &&
                info.main !== "" && (
                  <span className="dt-day-val">
                    {info.main}
                  </span>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarLegend() {
  return (
    <div className="dt-legend">
      <span>0%</span>
      <span className="dt-legend-bar" />
      <span>100%</span>
      <span className="dt-legend-none" />
      <span>No data</span>
    </div>
  );
}

function CalendarSection({ months, today, getCell }) {
  return (
    <section className="dt-calendar">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Calendar</div>

          <h2>Every day, month by month</h2>
        </div>

        <CalendarLegend />
      </div>

      <div className="dt-months">
        {months.map(({ year, month }) => (
          <MonthCalendar
            key={`${year}-${month}`}
            year={year}
            month={month}
            today={today}
            getCell={getCell}
          />
        ))}
      </div>
    </section>
  );
}

function Tile({ label, value, hint, primary = false }) {
  return (
    <div
      className={`dt-tile ${primary ? "dt-tile-primary" : ""}`}
    >
      <div className="dt-tile-label">{label}</div>

      <div className="dt-tile-value">{value}</div>

      {hint ? <div className="dt-tile-hint">{hint}</div> : null}
    </div>
  );
}

function DayScoreDetails({ scores, today, onBack }) {
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");

  const scoredKeys = useMemo(
    () =>
      Object.keys(scores)
        .filter((key) => key <= today)
        .sort(),
    [scores, today]
  );

  const firstKey = scoredKeys[0] || today;

  const allTime = useMemo(() => {
    if (scoredKeys.length === 0) return null;

    const total = scoredKeys.reduce(
      (sum, key) => sum + scores[key],
      0
    );

    return total / scoredKeys.length;
  }, [scoredKeys, scores]);

  const range = useMemo(() => {
    const a = fromInput || firstKey;
    const b = toInput || today;

    const lo = a <= b ? a : b;
    const hi = a <= b ? b : a;

    const keys = scoredKeys.filter(
      (key) => key >= lo && key <= hi
    );

    const total = keys.reduce(
      (sum, key) => sum + scores[key],
      0
    );

    return {
      count: keys.length,
      average: keys.length > 0 ? total / keys.length : null,
    };
  }, [fromInput, toInput, firstKey, today, scoredKeys, scores]);

  const months = useMemo(
    () => buildMonthList(firstKey, today),
    [firstKey, today]
  );

  const getCell = (key) => {
    const score = scores[key];

    if (score === undefined) {
      return {
        title: `${formatLongDate(key)} — No score`,
      };
    }

    return {
      intensity: score,
      main: Math.round(score),
      title: `${formatLongDate(key)} — ${formatScore(
        score
      )}%`,
    };
  };

  return (
    <div className="details-page dt-page">
      <div className="details-header">
        <button className="back-button" onClick={onBack}>
          <ChevronLeft size={20} />
          Habits
        </button>
      </div>

      <div className="details-title">
        <div>
          <div className="eyebrow">Day score</div>

          <h1>Daily scores</h1>
        </div>
      </div>

      <section className="dt-panel">
        <div className="dt-panel-head">
          <span className="dt-panel-title">Averages</span>
        </div>

        <div className="dt-tiles">
          <Tile
            primary
            label="All-time average"
            value={
              allTime === null
                ? "—"
                : `${formatScore(allTime)}%`
            }
            hint={`${scoredKeys.length} day${
              scoredKeys.length === 1 ? "" : "s"
            } scored`}
          />

          <div className="dt-calc">
            <label>
              From
              <input
                type="date"
                value={fromInput || firstKey}
                min={firstKey}
                max={today}
                onChange={(event) =>
                  setFromInput(event.target.value)
                }
              />
            </label>

            <label>
              To
              <input
                type="date"
                value={toInput || today}
                min={firstKey}
                max={today}
                onChange={(event) =>
                  setToInput(event.target.value)
                }
              />
            </label>

            <div className="dt-calc-result">
              <span className="dt-tile-label">
                Custom average
              </span>

              <strong>
                {range.average === null
                  ? "—"
                  : `${formatScore(range.average)}%`}
              </strong>

              <span className="dt-tile-hint">
                {range.count} day
                {range.count === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <CalendarSection
        months={months}
        today={today}
        getCell={getCell}
      />
    </div>
  );
}

/* =========================================================
   STREAKS
========================================================= */

function currentStreak(habit, records) {
  const today = dateKey();

  let cursor = today;

  /*
   If today's numeric value isn't complete yet, the streak
   should continue from yesterday rather than immediately
   becoming zero.
  */
  if (!isCompleted(habit, records[cursor])) {
    cursor = dateKey(addDays(new Date(), -1));
  }

  let streak = 0;

  while (isCompleted(habit, records[cursor])) {
    streak += 1;
    cursor = dateKey(
      addDays(parseDateKey(cursor), -1)
    );

    if (streak > 10000) break;
  }

  return streak;
}

function longestStreak(habit, records) {
  const dates = Object.keys(records).sort();

  let longest = 0;
  let current = 0;
  let previous = null;

  for (const key of dates) {
    if (!isCompleted(habit, records[key])) {
      current = 0;
      previous = key;
      continue;
    }

    if (
      previous &&
      dateKey(
        addDays(parseDateKey(previous), 1)
      ) === key
    ) {
      current += 1;
    } else {
      current = 1;
    }

    longest = Math.max(longest, current);
    previous = key;
  }

  return longest;
}

/* =========================================================
   STATISTICS
========================================================= */

function calculateStats(habit, records, dates) {
  const totalDays = dates.length;

  let completedDays = 0;
  let totalValue = 0;
  let totalAchievement = 0;
  let bestAchievement = 0;
  let bestDay = null;

  for (const key of dates) {
    const record = records[key];

    if (!record) continue;

    const percent = achievementPercent(habit, record);

    totalAchievement += Math.min(percent, 100);

    if (isCompleted(habit, record)) {
      completedDays += 1;
    }

    if (habit.type === "numeric") {
      totalValue += numericValue(record);
    }

    if (percent > bestAchievement) {
      bestAchievement = percent;
      bestDay = key;
    }
  }

  const completionRate =
    totalDays > 0
      ? (completedDays / totalDays) * 100
      : 0;

  const averageAchievement =
    totalDays > 0
      ? totalAchievement / totalDays
      : 0;

  const activeRecords = dates.filter(
    (key) => records[key]
  );

  const averageOnActiveDays =
    activeRecords.length > 0
      ? totalValue / activeRecords.length
      : 0;

  return {
    totalDays,
    completedDays,
    missedDays: Math.max(
      0,
      totalDays - completedDays
    ),
    completionRate,
    totalValue,
    averageValue:
      totalDays > 0 ? totalValue / totalDays : 0,
    averageOnActiveDays,
    averageAchievement,
    bestAchievement,
    bestDay,
    currentStreak: currentStreak(habit, records),
    longestStreak: longestStreak(habit, records),
  };
}

/* =========================================================
   FIRESTORE LOADING
========================================================= */

async function loadHabitRecords(
  uid,
  habitId,
  source = "server"
) {
  const records = {};

  const snapshot =
    source === "cache"
      ? await getDocsFromCache(
          RECORDS_PATH(uid, habitId)
        )
      : await getDocs(
          RECORDS_PATH(uid, habitId)
        );

  snapshot.forEach((recordDoc) => {
    records[recordDoc.id] = recordDoc.data();
  });

  return records;
}

async function loadHabits(
  uid,
  source = "server"
) {
  const snapshot =
    source === "cache"
      ? await getDocsFromCache(HABITS_PATH(uid))
      : await getDocs(HABITS_PATH(uid));

  const habits = [];

  for (const habitDoc of snapshot.docs) {
    const data = habitDoc.data();

    if (data.deleted) continue;

    const records = await loadHabitRecords(
      uid,
      habitDoc.id,
      source
    );

    habits.push({
      id: habitDoc.id,
      ...data,
      records,
    });
  }

  habits.sort(
    (a, b) =>
      Number(a.order ?? 0) -
      Number(b.order ?? 0)
  );

  return habits;
}

async function loadDeletedHabits(
  uid,
  source = "server"
) {
  const snapshot =
    source === "cache"
      ? await getDocsFromCache(HABITS_PATH(uid))
      : await getDocs(HABITS_PATH(uid));

  const habits = [];

  for (const habitDoc of snapshot.docs) {
    const data = habitDoc.data();

    if (!data.deleted) continue;

    const records = await loadHabitRecords(
      uid,
      habitDoc.id,
      source
    );

    habits.push({
      id: habitDoc.id,
      ...data,
      records,
    });
  }

  return habits;
}

/* =========================================================
   HEATMAP
========================================================= */

function Heatmap({
  habit,
  days,
  compact = false,
}) {
  return (
    <div
      className={`heatmap ${
        compact ? "heatmap-compact" : ""
      }`}
    >
      {days.map((key) => {
        const record = habit.records[key];
        const percent = clampedIntensity(
          habit,
          record
        );

        const completed = isCompleted(
          habit,
          record
        );

        return (
          <div
            key={key}
            className={`heat-cell ${
              !record
                ? "heat-empty"
                : completed
                ? "heat-complete"
                : "heat-partial"
            }`}
            style={{
              "--intensity": `${percent}%`,
            }}
            title={`${formatLongDate(key)} — ${
              habit.type === "boolean"
                ? completed
                  ? "Completed"
                  : "Not completed"
                : `${formatNumber(
                    numericValue(record)
                  )} ${
                    habit.unit || ""
                  } (${Math.round(percent)}%)`
            }`}
          />
        );
      })}
    </div>
  );
}

/* =========================================================
   HABIT CARD
========================================================= */

function HabitCard({
  habit,
  onToggleToday,
  onUpdateToday,
  onOpen,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDrop,
  isDragging,
}) {
  const today = dateKey();
  const todayRecord = habit.records[today];

  const todayPercent = achievementPercent(
    habit,
    todayRecord
  );

  const todayCompleted = isCompleted(
    habit,
    todayRecord
  );

  const streak = currentStreak(
    habit,
    habit.records
  );

  const days = getDateRange(MAIN_DAYS);

  const [menuOpen, setMenuOpen] = useState(false);

  const handleNumericChange = (event) => {
    const value = event.target.value;

    onUpdateToday(
      habit,
      value === "" ? 0 : Number(value)
    );
  };

  return (
    <article
      className={`habit-card ${
        isDragging ? "habit-dragging" : ""
      }`}
      draggable
      onDragStart={(event) =>
        onDragStart(event, habit.id)
      }
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(event, habit.id);
      }}
    >
      <div className="habit-card-top">
        <div className="habit-title-area">
          <div
            className="drag-handle"
            title="Drag to reorder"
          >
            <GripVertical size={20} />
          </div>

          <button
            className="habit-name-button"
            onClick={() => onOpen(habit.id)}
          >
            <span className="habit-name">
              {habit.name}
            </span>

            {habit.type === "numeric" && (
              <span className="habit-unit">
                {habit.unit || "units"} ·{" "}
                {formatNumber(
                  habit.referenceAmount
                )}/day
              </span>
            )}
          </button>
        </div>

        <div className="habit-menu-wrapper">
          <button
            className="icon-button"
            onClick={() =>
              setMenuOpen((value) => !value)
            }
            aria-label="Habit menu"
          >
            <MoreVertical size={20} />
          </button>

          {menuOpen && (
            <div className="habit-menu">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onEdit(habit);
                }}
              >
                <Pencil size={16} />
                Edit
              </button>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  onMoveUp(habit.id);
                }}
              >
                <ChevronUp size={16} />
                Move up
              </button>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  onMoveDown(habit.id);
                }}
              >
                <ChevronDown size={16} />
                Move down
              </button>

              <button
                className="danger-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(habit.id);
                }}
              >
                <Trash2 size={16} />
                Move to Bin
              </button>
            </div>
          )}
        </div>
      </div>

      <button
        className="habit-main-button"
        onClick={() => onOpen(habit.id)}
      >
        <div className="habit-progress-row">
          <div>
            <div className="today-label">
              Today
            </div>

            {habit.type === "numeric" ? (
              <div className="today-value">
                {formatNumber(
                  numericValue(todayRecord)
                )}
                <span>
                  {" "}
                  /{" "}
                  {formatNumber(
                    habit.referenceAmount
                  )}{" "}
                  {habit.unit || ""}
                </span>
              </div>
            ) : (
              <div className="today-value">
                {todayCompleted
                  ? "Completed"
                  : "Not completed"}
              </div>
            )}
          </div>

          <div className="today-percent">
            {habit.type === "numeric"
              ? `${Math.round(todayPercent)}%`
              : todayCompleted
              ? "✓"
              : "—"}
          </div>
        </div>

        {habit.type === "numeric" && (
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(
                  100,
                  todayPercent
                )}%`,
              }}
            />
          </div>
        )}

        <Heatmap
          habit={habit}
          days={days}
          compact
        />

        <div className="habit-footer">
          <span className="streak">
            <span className="streak-icon">
              🔥
            </span>
            {streak} day
            {streak === 1 ? "" : "s"} streak
          </span>

          <span className="view-details">
            View details
            <ChevronRight size={16} />
          </span>
        </div>
      </button>

      <div className="habit-action-row">
        {habit.type === "boolean" ? (
          <button
            className={`complete-button ${
              todayCompleted
                ? "complete-button-done"
                : ""
            }`}
            onClick={() =>
              onToggleToday(habit)
            }
          >
            {todayCompleted ? (
              <>
                <Check size={18} />
                Completed
              </>
            ) : (
              <>
                <Circle size={18} />
                Mark complete
              </>
            )}
          </button>
        ) : (
          <div className="numeric-entry">
            <button
              className="number-adjust"
              onClick={() =>
                onUpdateToday(
                  habit,
                  Math.max(
                    0,
                    numericValue(todayRecord) -
                      1
                  )
                )
              }
            >
              −
            </button>

            <input
              type="number"
              min="0"
              step="any"
              value={
                todayRecord
                  ? numericValue(todayRecord)
                  : ""
              }
              placeholder="0"
              onChange={handleNumericChange}
              onClick={(event) =>
                event.stopPropagation()
              }
            />

            <button
              className="number-adjust"
              onClick={() =>
                onUpdateToday(
                  habit,
                  numericValue(todayRecord) +
                    1
                )
              }
            >
              +
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatBox({
  label,
  value,
  icon,
}) {
  return (
    <div className="stat-box">
      <div className="stat-icon">
        {icon}
      </div>

      <div>
        <div className="stat-label">
          {label}
        </div>

        <div className="stat-value">
          {value}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   HABIT DETAILS
========================================================= */

function HabitDetails({
  habit,
  onBack,
  onEdit,
}) {
  const [period, setPeriod] = useState("90");

  const today = dateKey();

  const days90 = useMemo(
    () => getDateRange(DETAIL_DAYS),
    []
  );

  const allDates = useMemo(() => {
    const keys = Object.keys(habit.records);

    if (keys.length === 0) {
      return [];
    }

    const sorted = keys.sort();

    const start = parseDateKey(sorted[0]);
    const end = new Date();

    const dates = [];

    let cursor = new Date(start);

    while (cursor <= end) {
      dates.push(dateKey(cursor));
      cursor = addDays(cursor, 1);

      if (dates.length > 10000) break;
    }

    return dates;
  }, [habit.records]);

  const activeDates =
    period === "90" ? days90 : allDates;

  const stats = calculateStats(
    habit,
    habit.records,
    activeDates
  );

  const firstKey = firstRecordKey(habit);

  const months = useMemo(
    () => (firstKey ? buildMonthList(firstKey, today) : []),
    [firstKey, today]
  );

  const unit = habit.unit || "";

  const getCell = (key) => {
    const record = habit.records[key];

    if (!record) {
      return {
        title: `${formatLongDate(key)} — No entry`,
      };
    }

    const intensity = clampedIntensity(habit, record);
    const completed = isCompleted(habit, record);

    if (habit.type === "boolean") {
      return {
        intensity,
        main: completed ? "✓" : "",
        title: `${formatLongDate(key)} — ${
          completed ? "Completed" : "Not completed"
        }`,
      };
    }

    return {
      intensity,
      main: formatNumber(numericValue(record)),
      title: `${formatLongDate(key)} — ${formatNumber(
        numericValue(record)
      )} ${unit} (${Math.round(
        achievementPercent(habit, record)
      )}%)`,
    };
  };

  return (
    <div className="details-page dt-page">
      <div className="details-header">
        <button
          className="back-button"
          onClick={onBack}
        >
          <ChevronLeft size={20} />
          Habits
        </button>

        <button
          className="outline-button"
          onClick={() => onEdit(habit)}
        >
          <Pencil size={17} />
          Edit
        </button>
      </div>

      <div className="details-title">
        <div>
          <div className="eyebrow">Habit details</div>

          <h1>{habit.name}</h1>

          {habit.type === "numeric" && (
            <p>
              Goal: {formatNumber(habit.referenceAmount)}{" "}
              {habit.unit || "units"} per day
            </p>
          )}
        </div>
      </div>

      {firstKey ? (
        <>
          <section className="dt-panel">
            <div className="dt-panel-head">
              <span className="dt-panel-title">
                Statistics
              </span>

              <div className="segmented-control">
                <button
                  className={
                    period === "90" ? "active" : ""
                  }
                  onClick={() => setPeriod("90")}
                >
                  90 days
                </button>

                <button
                  className={
                    period === "all" ? "active" : ""
                  }
                  onClick={() => setPeriod("all")}
                >
                  All history
                </button>
              </div>
            </div>

            <div className="dt-tiles">
              <Tile
                primary
                label="Completion"
                value={`${Math.round(
                  stats.completionRate
                )}%`}
                hint={`${stats.completedDays} of ${stats.totalDays} days`}
              />

              <Tile
                label="Current streak"
                value={`${stats.currentStreak} day${
                  stats.currentStreak === 1 ? "" : "s"
                }`}
              />

              <Tile
                label="Longest streak"
                value={`${stats.longestStreak} day${
                  stats.longestStreak === 1 ? "" : "s"
                }`}
              />

              <Tile
                label="Avg achievement"
                value={`${Math.round(
                  stats.averageAchievement
                )}%`}
              />

              <Tile
                label="Missed days"
                value={stats.missedDays}
              />

              {habit.type === "numeric" && (
                <>
                  <Tile
                    label="Daily average"
                    value={`${formatNumber(
                      stats.averageValue
                    )} ${unit}`}
                  />

                  <Tile
                    label="Total"
                    value={`${formatNumber(
                      stats.totalValue
                    )} ${unit}`}
                  />

                  <Tile
                    label="Best day"
                    value={
                      stats.bestDay
                        ? formatShortDate(stats.bestDay)
                        : "—"
                    }
                  />
                </>
              )}
            </div>
          </section>

          <CalendarSection
            months={months}
            today={today}
            getCell={getCell}
          />
        </>
      ) : (
        <div className="empty-state">
          <CalendarDays size={42} />

          <h3>No history yet</h3>

          <p>
            Start tracking this habit and your calendar
            and statistics will appear here.
          </p>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   LOGIN
========================================================= */

function LoginScreen() {
  const [loading, setLoading] =
    useState(false);
  const [error, setError] = useState("");

  const login = async () => {
    setLoading(true);
    setError("");

    try {
      await signInWithPopup(
        auth,
        new GoogleAuthProvider()
      );
    } catch (err) {
      console.error(err);
      setError(
        "Unable to sign in. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="app-logo">
          ✓
        </div>

        <div className="eyebrow">
          Personal productivity
        </div>

        <h1>Habit Tracker</h1>

        <p>
          Build consistency, one day at a
          time.
        </p>

        <button
          className="primary-button login-button"
          onClick={login}
          disabled={loading}
        >
          {loading
            ? "Signing in..."
            : "Continue with Google"}
        </button>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}

/* =========================================================
   HABIT MODAL
========================================================= */

function HabitModal({
  habit,
  onClose,
  onSave,
}) {
  const [name, setName] = useState(
    habit?.name || ""
  );

  const [type, setType] = useState(
    habit?.type || "numeric"
  );

  const [unit, setUnit] = useState(
    habit?.unit || "hours"
  );

  const [referenceAmount, setReferenceAmount] =
    useState(
      habit?.referenceAmount ?? 1
    );

  const [weight, setWeight] = useState(
    habit?.weight ?? 1
  );

  const [saving, setSaving] =
    useState(false);

  const save = async (event) => {
    event.preventDefault();

    if (!name.trim()) return;

    setSaving(true);

    await onSave({
      id: habit?.id,
      name: name.trim(),
      type,
      unit:
        type === "numeric"
          ? unit.trim()
          : "",
      referenceAmount:
        type === "numeric"
          ? Math.max(
              0.0001,
              Number(referenceAmount) || 0
            )
          : 1,
      weight: Math.max(0.01, Number(weight) || 1),
    });

    setSaving(false);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">
              {habit
                ? "Edit habit"
                : "New habit"}
            </div>

            <h2>
              {habit
                ? "Update habit"
                : "Create a habit"}
            </h2>
          </div>

          <button
            className="icon-button"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={save}>
          <label>
            Habit name
            <input
              autoFocus
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="e.g. Study"
            />
          </label>

          <label>
            Type
            <select
              value={type}
              onChange={(event) =>
                setType(event.target.value)
              }
            >
              <option value="numeric">
                Numeric
              </option>
              <option value="boolean">
                Yes / No
              </option>
            </select>
          </label>

          {type === "numeric" && (
            <>
              <label>
                Unit
                <input
                  value={unit}
                  onChange={(event) =>
                    setUnit(
                      event.target.value
                    )
                  }
                  placeholder="hours"
                />
              </label>

              <label>
                Daily reference
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={referenceAmount}
                  onChange={(event) =>
                    setReferenceAmount(
                      event.target.value
                    )
                  }
                />

                <span className="input-help">
                  Historical values stay unchanged;
                  percentages recalculate using
                  this current reference.
                </span>
              </label>
            </>
          )}

          <label>
            Weight
            <input
              type="number"
              min="0.01"
              step="any"
              value={weight}
              onChange={(event) =>
                setWeight(event.target.value)
              }
            />

            <span className="input-help">
              How much this habit counts towards the daily
              score. Changes apply from today onward; scores
              of past days never change.
            </span>
          </label>

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={
                saving || !name.trim()
              }
            >
              {saving
                ? "Saving..."
                : habit
                ? "Save changes"
                : "Create habit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* =========================================================
   WEIGHTS MODAL
========================================================= */

function WeightsModal({ habits, onClose, onSave }) {
  const [values, setValues] = useState(() => {
    const initial = {};

    for (const habit of habits) {
      initial[habit.id] = String(habitWeight(habit));
    }

    return initial;
  });

  const [saving, setSaving] = useState(false);

  const parsed = habits.map((habit) => {
    const number = Number(values[habit.id]);

    return Number.isFinite(number) && number > 0
      ? number
      : null;
  });

  const valid = parsed.every((value) => value !== null);

  const total = valid
    ? parsed.reduce((sum, value) => sum + value, 0)
    : 0;

  const save = async (event) => {
    event.preventDefault();

    if (!valid) return;

    const changes = {};

    habits.forEach((habit, index) => {
      if (parsed[index] !== habitWeight(habit)) {
        changes[habit.id] = parsed[index];
      }
    });

    setSaving(true);
    await onSave(changes);
    setSaving(false);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">Day score</div>

            <h2>Habit weights</h2>
          </div>

          <button
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={save}>
          <div className="ds-weight-list">
            {habits.map((habit, index) => (
              <div className="ds-weight-row" key={habit.id}>
                <div className="ds-weight-name">
                  <strong>{habit.name}</strong>

                  <span>
                    {parsed[index] !== null && total > 0
                      ? `${formatScore(
                          (parsed[index] / total) * 100
                        )}% of the score`
                      : "Enter a number above 0"}
                  </span>
                </div>

                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={values[habit.id]}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [habit.id]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <span className="input-help">
            Changes apply from today onward. Scores of past
            days never change.
          </span>

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={saving || !valid}
            >
              {saving ? "Saving..." : "Save weights"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  const [user, setUser] = useState(null);

  const [habits, setHabits] =
    useState([]);

  const [deletedHabits, setDeletedHabits] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [syncStatus, setSyncStatus] =
    useState("loading");

  const [online, setOnline] =
    useState(navigator.onLine);

  const [modalOpen, setModalOpen] =
    useState(false);

  const [editingHabit, setEditingHabit] =
    useState(null);

  const [selectedHabitId, setSelectedHabitId] =
    useState(null);

  const [showBin, setShowBin] =
    useState(false);

  const [draggedHabitId, setDraggedHabitId] =
    useState(null);

  const [showMenu, setShowMenu] =
    useState(false);

  const [dayScores, setDayScores] =
    useState({});

  const [serverReady, setServerReady] =
    useState(false);

  const [showDayDetails, setShowDayDetails] =
    useState(false);

  const backfillBusy = useRef(false);

  const [showWeights, setShowWeights] =
    useState(false);

  /* -------------------------------------------------------
     AUTH
  ------------------------------------------------------- */

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      async (currentUser) => {
        setUser(currentUser);

        if (!currentUser) {
          setHabits([]);
          setDeletedHabits([]);
          setDayScores({});
          setServerReady(false);
          setShowDayDetails(false);
          setLoading(false);
          return;
        }

        setLoading(true);
        setServerReady(false);
        setSyncStatus("loading");

        try {
          /*
           * Cache first.
           */
          try {
            const localHabits =
              await loadHabits(
                currentUser.uid,
                "cache"
              );

            const localDeleted =
              await loadDeletedHabits(
                currentUser.uid,
                "cache"
              );

            setHabits(localHabits);
            setDeletedHabits(
              localDeleted
            );

            setLoading(false);
            setSyncStatus(
              navigator.onLine
                ? "syncing"
                : "offline"
            );
          } catch (cacheError) {
            console.log(
              "No local cache yet.",
              cacheError
            );
          }

          try {
            const localScores = await loadDayScores(
              currentUser.uid,
              "cache"
            );

            setDayScores(localScores);
          } catch (scoreCacheError) {
            console.log(
              "No cached daily scores yet.",
              scoreCacheError
            );
          }

          /*
           * Server refresh.
           */
          if (navigator.onLine) {
            try {
              const serverHabits =
                await loadHabits(
                  currentUser.uid,
                  "server"
                );

              const serverDeleted =
                await loadDeletedHabits(
                  currentUser.uid,
                  "server"
                );

              setHabits(serverHabits);
              setDeletedHabits(
                serverDeleted
              );

              setSyncStatus("synced");

              try {
                const serverScores =
                  await loadDayScores(
                    currentUser.uid,
                    "server"
                  );

                setDayScores(serverScores);
                setServerReady(true);
              } catch (scoreError) {
                console.error(
                  "Could not load daily scores.",
                  scoreError
                );
              }
            } catch (serverError) {
              console.error(
                serverError
              );

              setSyncStatus(
                "offline"
              );
            }
          } else {
            setSyncStatus("offline");
          }
        } catch (error) {
          console.error(error);
          setSyncStatus("offline");
        } finally {
          setLoading(false);
        }
      }
    );
  }, []);

  /* -------------------------------------------------------
     ONLINE / OFFLINE
  ------------------------------------------------------- */

  useEffect(() => {
    const handleOnline = async () => {
      setOnline(true);

      if (!user) return;

      setSyncStatus("syncing");

      try {
        const serverHabits =
          await loadHabits(
            user.uid,
            "server"
          );

        const serverDeleted =
          await loadDeletedHabits(
            user.uid,
            "server"
          );

        setHabits(serverHabits);
        setDeletedHabits(
          serverDeleted
        );

        setSyncStatus("synced");

        try {
          const serverScores =
            await loadDayScores(
              user.uid,
              "server"
            );

          setDayScores(serverScores);
          setServerReady(true);
        } catch (scoreError) {
          console.error(
            "Could not load daily scores.",
            scoreError
          );
        }
      } catch (error) {
        console.error(error);
        setSyncStatus("offline");
      }
    };

    const handleOffline = () => {
      setOnline(false);
      setSyncStatus("offline");
    };

    window.addEventListener(
      "online",
      handleOnline
    );

    window.addEventListener(
      "offline",
      handleOffline
    );

    return () => {
      window.removeEventListener(
        "online",
        handleOnline
      );

      window.removeEventListener(
        "offline",
        handleOffline
      );
    };
  }, [user]);

  /* -------------------------------------------------------
     SAVE HABIT
  ------------------------------------------------------- */

  const saveHabit = async (data) => {
    if (!user) return;

    const existing = data.id
      ? habits.find(
          (habit) =>
            habit.id === data.id
        )
      : null;

    const habitId =
      data.id ||
      crypto.randomUUID();

    const habit = {
      name: data.name,
      type: data.type,
      unit: data.unit || "",
      referenceAmount:
        Number(data.referenceAmount) || 1,
      weight:
        Math.max(0.01, Number(data.weight) || 1),
      order:
        existing?.order ??
        habits.length,
      deleted: false,
    };

    setHabits((current) => {
      if (existing) {
        return current.map((item) =>
          item.id === habitId
            ? {
                ...item,
                ...habit,
              }
            : item
        );
      }

      return [
        ...current,
        {
          id: habitId,
          ...habit,
          records: {},
        },
      ];
    });

    setModalOpen(false);
    setEditingHabit(null);

    setSyncStatus(
      navigator.onLine
        ? "syncing"
        : "offline"
    );

    try {
      await setDoc(
        HABIT_PATH(
          user.uid,
          habitId
        ),
        habit,
        { merge: true }
      );

      setSyncStatus(
        navigator.onLine
          ? "synced"
          : "offline"
      );
    } catch (error) {
      console.error(error);

      /*
       * Firestore persistent cache may accept
       * writes while offline. If this really fails,
       * keep the optimistic UI but show offline.
       */
      setSyncStatus("offline");
    }
  };

  /* -------------------------------------------------------
     UPDATE TODAY
  ------------------------------------------------------- */

  const updateToday = async (
    habit,
    value
  ) => {
    if (!user) return;

    const today = dateKey();

    const cleanValue = Math.max(
      0,
      Number(value) || 0
    );

    setHabits((current) =>
      current.map((item) =>
        item.id === habit.id
          ? {
              ...item,
              records: {
                ...item.records,
                [today]: {
                  value: cleanValue,
                },
              },
            }
          : item
      )
    );

    setSyncStatus(
      navigator.onLine
        ? "syncing"
        : "offline"
    );

    try {
      await setDoc(
        RECORD_PATH(
          user.uid,
          habit.id,
          today
        ),
        {
          value: cleanValue,
        }
      );

      setSyncStatus(
        navigator.onLine
          ? "synced"
          : "offline"
      );
    } catch (error) {
      console.error(error);
      setSyncStatus("offline");
    }
  };

  /* -------------------------------------------------------
     TOGGLE TODAY
  ------------------------------------------------------- */

  const toggleToday = async (
    habit
  ) => {
    if (!user) return;

    const today = dateKey();

    const currentlyDone =
      isCompleted(
        habit,
        habit.records[today]
      );

    const newValue = !currentlyDone;

    setHabits((current) =>
      current.map((item) =>
        item.id === habit.id
          ? {
              ...item,
              records: {
                ...item.records,
                [today]: {
                  value: newValue,
                },
              },
            }
          : item
      )
    );

    setSyncStatus(
      navigator.onLine
        ? "syncing"
        : "offline"
    );

    try {
      await setDoc(
        RECORD_PATH(
          user.uid,
          habit.id,
          today
        ),
        {
          value: newValue,
        }
      );

      setSyncStatus(
        navigator.onLine
          ? "synced"
          : "offline"
      );
    } catch (error) {
      console.error(error);
      setSyncStatus("offline");
    }
  };

  /* -------------------------------------------------------
     MOVE TO BIN
  ------------------------------------------------------- */

  const moveToBin = async (
    habitId
  ) => {
    if (!user) return;

    const deletedAt =
      new Date().toISOString();

    setHabits((current) =>
      current.filter(
        (habit) =>
          habit.id !== habitId
      )
    );

    const habit =
      habits.find(
        (item) =>
          item.id === habitId
      );

    if (habit) {
      setDeletedHabits((current) => [
        ...current,
        {
          ...habit,
          deleted: true,
          deletedAt,
        },
      ]);
    }

    try {
      await setDoc(
        HABIT_PATH(
          user.uid,
          habitId
        ),
        {
          deleted: true,
          deletedAt,
        },
        { merge: true }
      );
    } catch (error) {
      console.error(error);
      setSyncStatus("offline");
    }
  };

  /* -------------------------------------------------------
     RESTORE
  ------------------------------------------------------- */

  const restoreHabit = async (
    habitId
  ) => {
    if (!user) return;

    const habit =
      deletedHabits.find(
        (item) =>
          item.id === habitId
      );

    if (!habit) return;

    const restored = {
      ...habit,
      deleted: false,
    };

    delete restored.deletedAt;

    setDeletedHabits((current) =>
      current.filter(
        (item) =>
          item.id !== habitId
      )
    );

    setHabits((current) =>
      [
        ...current,
        restored,
      ].sort(
        (a, b) =>
          Number(a.order ?? 0) -
          Number(b.order ?? 0)
      )
    );

    await setDoc(
      HABIT_PATH(
        user.uid,
        habitId
      ),
      restored,
      { merge: true }
    );
  };

  /* -------------------------------------------------------
     PERMANENT DELETE
  ------------------------------------------------------- */

  const permanentlyDelete = async (
    habitId
  ) => {
    if (!user) return;

    if (!navigator.onLine) {
      alert(
        "Permanent deletion requires an internet connection."
      );
      return;
    }

    const confirmed = window.confirm(
      "Permanently delete this habit and all of its history?"
    );

    if (!confirmed) return;

    try {
      const records =
        await getDocs(
          RECORDS_PATH(
            user.uid,
            habitId
          )
        );

      const batch = writeBatch(db);

      records.forEach(
        (recordDoc) => {
          batch.delete(
            recordDoc.ref
          );
        }
      );

      batch.delete(
        HABIT_PATH(
          user.uid,
          habitId
        )
      );

      await batch.commit();

      setDeletedHabits((current) =>
        current.filter(
          (habit) =>
            habit.id !== habitId
        )
      );
    } catch (error) {
      console.error(error);
      alert(
        "Could not permanently delete the habit."
      );
    }
  };

  /* -------------------------------------------------------
     DRAG / DROP ORDER
  ------------------------------------------------------- */

  const reorderHabits = async (
    draggedId,
    targetId
  ) => {
    if (
      !draggedId ||
      draggedId === targetId
    ) {
      return;
    }

    const oldIndex =
      habits.findIndex(
        (habit) =>
          habit.id === draggedId
      );

    const newIndex =
      habits.findIndex(
        (habit) =>
          habit.id === targetId
      );

    if (
      oldIndex < 0 ||
      newIndex < 0
    ) {
      return;
    }

    const reordered = [
      ...habits,
    ];

    const [
      movedHabit,
    ] = reordered.splice(
      oldIndex,
      1
    );

    reordered.splice(
      newIndex,
      0,
      movedHabit
    );

    const withOrders =
      reordered.map(
        (habit, index) => ({
          ...habit,
          order: index,
        })
      );

    setHabits(withOrders);

    try {
      const batch = writeBatch(db);

      withOrders.forEach(
        (habit) => {
          batch.set(
            HABIT_PATH(
              user.uid,
              habit.id
            ),
            {
              order: habit.order,
            },
            { merge: true }
          );
        }
      );

      await batch.commit();
    } catch (error) {
      console.error(error);
      setSyncStatus("offline");
    }
  };

  const moveHabit = async (
    habitId,
    direction
  ) => {
    const index =
      habits.findIndex(
        (habit) =>
          habit.id === habitId
      );

    if (index < 0) return;

    const target =
      index + direction;

    if (
      target < 0 ||
      target >= habits.length
    ) {
      return;
    }

    await reorderHabits(
      habitId,
      habits[target].id
    );
  };

  /* -------------------------------------------------------
     SAVE WEIGHTS (all habits at once)
  ------------------------------------------------------- */

  const saveWeights = async (changes) => {
    const ids = Object.keys(changes);

    setShowWeights(false);

    if (!user || ids.length === 0) return;

    setHabits((current) =>
      current.map((habit) =>
        changes[habit.id] !== undefined
          ? { ...habit, weight: changes[habit.id] }
          : habit
      )
    );

    setSyncStatus(
      navigator.onLine ? "syncing" : "offline"
    );

    try {
      const batch = writeBatch(db);

      for (const id of ids) {
        batch.set(
          HABIT_PATH(user.uid, id),
          { weight: changes[id] },
          { merge: true }
        );
      }

      await batch.commit();

      setSyncStatus(
        navigator.onLine ? "synced" : "offline"
      );
    } catch (error) {
      console.error(error);
      setSyncStatus("offline");
    }
  };

  /* -------------------------------------------------------
     DERIVED VALUES
  ------------------------------------------------------- */

  const today = dateKey();

  const todayStats = useMemo(() => {
    let completed = 0;

    for (const habit of habits) {
      if (
        isCompleted(
          habit,
          habit.records[today]
        )
      ) {
        completed += 1;
      }
    }

    return {
      completed,
      total: habits.length,
      percent:
        habits.length > 0
          ? (completed /
              habits.length) *
            100
          : 0,
    };
  }, [habits, today]);

  const todayScore = useMemo(
    () =>
      roundScore(calculateDayScore(habits, today) ?? 0),
    [habits, today]
  );

  const storedToday = dayScores[today];

  /*
   * Keep TODAY's score saved while the day is still running.
   * Only today's document is ever written here.
   */
  useEffect(() => {
    if (!user || !serverReady) return;
    if (habits.length === 0) return;
    if (storedToday === todayScore) return;
    if (today !== dateKey()) return;

    setDayScores((current) => ({
      ...current,
      [today]: todayScore,
    }));

    setDoc(DAY_SCORE_PATH(user.uid, today), {
      date: today,
      score: todayScore,
      updatedAt: new Date().toISOString(),
    }).catch((error) => {
      console.error("Could not save daily score.", error);
    });
  }, [
    user,
    serverReady,
    habits.length,
    today,
    todayScore,
    storedToday,
  ]);

  /*
   * Fill in past days that have no saved score yet
   * (first run of this feature, or days the app was not
   * opened). Days that already have a score are never touched.
   */
  useEffect(() => {
    if (!user || !serverReady) return;
    if (backfillBusy.current) return;
    if (habits.length === 0) return;

    const starts = new Map();
    let earliest = null;

    for (const habit of habits) {
      const first = firstRecordKey(habit);

      if (!first) continue;

      starts.set(habit.id, first);

      if (earliest === null || first < earliest) {
        earliest = first;
      }
    }

    if (!earliest) return;

    const entries = {};

    let cursor = parseDateKey(earliest);
    const end = parseDateKey(today);
    let guard = 0;

    while (cursor < end && guard < 5000) {
      const key = dateKey(cursor);

      if (dayScores[key] === undefined) {
        const score = calculateDayScore(habits, key, starts);

        if (score !== null) {
          entries[key] = roundScore(score);
        }
      }

      cursor = addDays(cursor, 1);
      guard += 1;
    }

    const keys = Object.keys(entries);

    if (keys.length === 0) return;

    backfillBusy.current = true;

    setDayScores((current) => ({ ...entries, ...current }));

    (async () => {
      try {
        for (let i = 0; i < keys.length; i += 400) {
          const batch = writeBatch(db);

          for (const key of keys.slice(i, i + 400)) {
            batch.set(DAY_SCORE_PATH(user.uid, key), {
              date: key,
              score: entries[key],
              updatedAt: new Date().toISOString(),
            });
          }

          await batch.commit();
        }
      } catch (error) {
        console.error("Could not save past daily scores.", error);
      } finally {
        backfillBusy.current = false;
      }
    })();
  }, [user, serverReady, habits, dayScores, today]);

  const scoresForCalendar = useMemo(
    () =>
      habits.length > 0
        ? { ...dayScores, [today]: todayScore }
        : dayScores,
    [dayScores, habits.length, today, todayScore]
  );

  const selectedHabit =
    selectedHabitId
      ? habits.find(
          (habit) =>
            habit.id ===
            selectedHabitId
        )
      : null;

  /* -------------------------------------------------------
     LOADING / AUTH
  ------------------------------------------------------- */

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <span>
          Loading your habits...
        </span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  /* -------------------------------------------------------
     DAY SCORE DETAILS PAGE
  ------------------------------------------------------- */

  if (showDayDetails) {
    return (
      <div className="app-shell">
        <DayScoreDetails
          scores={scoresForCalendar}
          today={today}
          onBack={() => setShowDayDetails(false)}
        />
      </div>
    );
  }

  /* -------------------------------------------------------
     DETAILS PAGE
  ------------------------------------------------------- */

  if (selectedHabit) {
    return (
      <div className="app-shell">
        <HabitDetails
          habit={selectedHabit}
          onBack={() =>
            setSelectedHabitId(null)
          }
          onEdit={(habit) => {
            setEditingHabit(habit);
            setModalOpen(true);
          }}
        />

        {modalOpen && (
          <HabitModal
            habit={editingHabit}
            onClose={() => {
              setModalOpen(false);
              setEditingHabit(null);
            }}
            onSave={saveHabit}
          />
        )}
      </div>
    );
  }

  /* -------------------------------------------------------
     MAIN UI
  ------------------------------------------------------- */

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-icon">
              ✓
            </div>

            <div>
              <strong>
                Habit Tracker
              </strong>

              <span>
                {formatLongDate(today)}
              </span>
            </div>
          </div>

          <div className="header-actions">
            <div
              className={`sync-status ${
                syncStatus
              }`}
            >
              <span className="status-dot" />

              {syncStatus ===
              "syncing"
                ? "Syncing..."
                : syncStatus ===
                  "synced"
                ? "Synced"
                : syncStatus ===
                  "offline"
                ? "Offline"
                : "Loading"}
            </div>

            <button
              className="icon-button"
              onClick={() =>
                setShowMenu(
                  (value) => !value
                )
              }
            >
              <MoreVertical size={20} />
            </button>

            {showMenu && (
              <div className="account-menu">
                <div className="account-email">
                  {user.email}
                </div>

                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowBin(true);
                  }}
                >
                  <Trash2 size={16} />
                  Bin
                  {deletedHabits.length >
                    0 && (
                    <span className="menu-count">
                      {
                        deletedHabits.length
                      }
                    </span>
                  )}
                </button>

                <button
                  onClick={async () => {
                    setShowMenu(false);
                    await signOut(auth);
                  }}
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="today-summary">
          <div>
            <div className="eyebrow">
              Today
            </div>

            <h1>
              Keep the streak alive.
            </h1>

            <p>
              {todayStats.total === 0
                ? "Create your first habit."
                : `${todayStats.completed} of ${todayStats.total} habits completed.`}
            </p>
          </div>

          <div className="today-summary-progress">
            <div className="ds-bar-label">Day score</div>

            <div className="summary-percent">
              {formatScore(todayScore)}%
            </div>

            <div className="summary-track">
              <div
                style={{
                  width: `${Math.min(100, todayScore)}%`,
                }}
              />
            </div>

            <div className="ds-bar-actions">
              <button
                className="ds-view-details"
                onClick={() => setShowDayDetails(true)}
              >
                View details
                <ChevronRight size={16} />
              </button>

              {habits.length > 0 && (
                <button
                  className="ds-view-details"
                  onClick={() => setShowWeights(true)}
                >
                  <Settings size={14} />
                  Adjust weights
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="habits-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                Habits
              </div>

              <h2>
                Last 30 days
              </h2>
            </div>

            <button
              className="primary-button add-button"
              onClick={() => {
                setEditingHabit(null);
                setModalOpen(true);
              }}
            >
              <Plus size={18} />
              Add habit
            </button>
          </div>

          {habits.length === 0 ? (
            <div className="empty-state main-empty">
              <div className="empty-icon">
                <BarChart3 size={32} />
              </div>

              <h3>
                No habits yet
              </h3>

              <p>
                Add your first habit and
                start building consistency.
              </p>

              <button
                className="primary-button"
                onClick={() => {
                  setEditingHabit(null);
                  setModalOpen(true);
                }}
              >
                <Plus size={18} />
                Add your first habit
              </button>
            </div>
          ) : (
            <div className="habit-list">
              {habits.map(
                (habit, index) => (
                  <HabitCard
                    key={habit.id}
                    habit={habit}
                    isDragging={
                      draggedHabitId ===
                      habit.id
                    }
                    onDragStart={(
                      event,
                      id
                    ) => {
                      setDraggedHabitId(
                        id
                      );

                      event.dataTransfer.effectAllowed =
                        "move";

                      event.dataTransfer.setData(
                        "text/plain",
                        id
                      );
                    }}
                    onDrop={(
                      event,
                      targetId
                    ) => {
                      const draggedId =
                        event.dataTransfer.getData(
                          "text/plain"
                        );

                      reorderHabits(
                        draggedId,
                        targetId
                      );

                      setDraggedHabitId(
                        null
                      );
                    }}
                    onToggleToday={
                      toggleToday
                    }
                    onUpdateToday={
                      updateToday
                    }
                    onOpen={(id) =>
                      setSelectedHabitId(
                        id
                      )
                    }
                    onEdit={(habit) => {
                      setEditingHabit(
                        habit
                      );
                      setModalOpen(true);
                    }}
                    onDelete={
                      moveToBin
                    }
                    onMoveUp={(id) =>
                      moveHabit(id, -1)
                    }
                    onMoveDown={(id) =>
                      moveHabit(id, 1)
                    }
                  />
                )
              )}
            </div>
          )}
        </section>

        {habits.length > 0 && (
          <section className="quick-stats-section">
            <div className="section-heading">
              <div>
                <div className="eyebrow">
                  Overview
                </div>

                <h2>
                  Your consistency
                </h2>
              </div>
            </div>

            <div className="overview-grid">
              <StatBox
                label="Completed today"
                value={`${todayStats.completed}/${todayStats.total}`}
                icon="✓"
              />

              <StatBox
                label="Completion today"
                value={`${Math.round(
                  todayStats.percent
                )}%`}
                icon="📈"
              />

              <StatBox
                label="Active habits"
                value={habits.length}
                icon="●"
              />

              <StatBox
                label="Longest streak"
                value={`${Math.max(
                  ...habits.map(
                    (habit) =>
                      longestStreak(
                        habit,
                        habit.records
                      )
                  ),
                  0
                )} days`}
                icon="🏆"
              />
            </div>
          </section>
        )}
      </main>

      {modalOpen && (
        <HabitModal
          habit={editingHabit}
          onClose={() => {
            setModalOpen(false);
            setEditingHabit(null);
          }}
          onSave={saveHabit}
        />
      )}

      {showWeights && (
        <WeightsModal
          habits={habits}
          onClose={() => setShowWeights(false)}
          onSave={saveWeights}
        />
      )}

      {showBin && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowBin(false);
            }
          }}
        >
          <div className="modal bin-modal">
            <div className="modal-header">
              <div>
                <div className="eyebrow">
                  Recycle bin
                </div>

                <h2>
                  Deleted habits
                </h2>
              </div>

              <button
                className="icon-button"
                onClick={() =>
                  setShowBin(false)
                }
              >
                <X size={20} />
              </button>
            </div>

            {deletedHabits.length ===
            0 ? (
              <div className="empty-state">
                <Trash2 size={38} />

                <h3>
                  Bin is empty
                </h3>

                <p>
                  Deleted habits will appear
                  here.
                </p>
              </div>
            ) : (
              <div className="bin-list">
                {deletedHabits.map(
                  (habit) => (
                    <div
                      className="bin-item"
                      key={habit.id}
                    >
                      <div>
                        <strong>
                          {habit.name}
                        </strong>

                        <span>
                          Moved to bin
                        </span>
                      </div>

                      <div className="bin-actions">
                        <button
                          className="icon-button"
                          title="Restore"
                          onClick={() =>
                            restoreHabit(
                              habit.id
                            )
                          }
                        >
                          <RotateCcw
                            size={18}
                          />
                        </button>

                        <button
                          className="icon-button danger-button"
                          title="Delete permanently"
                          onClick={() =>
                            permanentlyDelete(
                              habit.id
                            )
                          }
                        >
                          <Trash2
                            size={18}
                          />
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
