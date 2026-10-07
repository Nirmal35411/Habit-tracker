import { useMemo, useState } from "react";
import {
  Plus,
  Flame,
  Trash2,
  RotateCcw,
  Check,
  X,
  GripVertical,
  BarChart3,
  CalendarDays,
  Archive,
  Settings,
} from "lucide-react";

const today = new Date().toISOString().slice(0, 10);

const initialHabits = [
  {
    id: "study",
    name: "Study",
    type: "numeric",
    unit: "hours",
    referenceAmount: 4,
    order: 0,
    deleted: false,
    records: {
      [today]: 3
    }
  },
  {
    id: "exercise",
    name: "Exercise",
    type: "boolean",
    unit: "",
    referenceAmount: null,
    order: 1,
    deleted: false,
    records: {
      [today]: true
    }
  }
];

function intensity(value, reference) {
  if (!value || !reference) return 0;

  const ratio = value / reference;

  if (ratio >= 1) return 4;
  if (ratio >= 0.75) return 3;
  if (ratio >= 0.5) return 2;
  if (ratio > 0) return 1;

  return 0;
}

function getStreak(habit) {
  let date = new Date();

  let streak = 0;

  while (true) {
    const key = date.toISOString().slice(0, 10);
    const value = habit.records[key];

    const successful =
      habit.type === "boolean"
        ? value === true
        : Number(value || 0) >= habit.referenceAmount;

    if (!successful) break;

    streak++;

    date.setDate(date.getDate() - 1);
  }

  return streak;
}

function Calendar({ habit }) {
  const days = useMemo(() => {
    const result = [];

    const now = new Date();

    for (let i = 89; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);

      result.push(date);
    }

    return result;
  }, []);

  return (
    <div className="calendar-wrapper">
      <div className="calendar">
        {days.map((date) => {
          const key = date.toISOString().slice(0, 10);
          const value = habit.records[key];

          let level = 0;

          if (habit.type === "boolean") {
            level = value ? 4 : 0;
          } else {
            level = intensity(value, habit.referenceAmount);
          }

          return (
            <div
              key={key}
              className={`day level-${level}`}
              title={`${key}: ${
                habit.type === "boolean"
                  ? value
                    ? "Done"
                    : "Not done"
                  : `${value || 0} ${habit.unit}`
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function HabitCard({
  habit,
  onToggleToday,
  onDelete,
  onEdit,
}) {
  const todayValue = habit.records[today];

  const streak = getStreak(habit);

  return (
    <div className="habit-card">
      <div className="habit-header">
        <div className="habit-title-area">
          <GripVertical className="drag-icon" size={19} />

          <div>
            <h2>{habit.name}</h2>

            {habit.type === "numeric" ? (
              <p>
                Reference: {habit.referenceAmount} {habit.unit}
              </p>
            ) : (
              <p>Yes / No habit</p>
            )}
          </div>
        </div>

        <div className="habit-actions">
          <button onClick={() => onEdit(habit)} title="Edit">
            <Settings size={17} />
          </button>

          <button onClick={() => onDelete(habit)} title="Move to bin">
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      <Calendar habit={habit} />

      <div className="habit-footer">
        <div className="streak">
          <Flame size={17} />
          <strong>{streak}</strong>
          <span>day streak</span>
        </div>

        <button className="today-button" onClick={() => onToggleToday(habit)}>
          {habit.type === "boolean" ? (
            todayValue ? (
              <>
                <Check size={17} /> Done
              </>
            ) : (
              <>
                <X size={17} /> Mark done
              </>
            )
          ) : (
            <>
              Today: {todayValue || 0} {habit.unit}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function App() {
  const [habits, setHabits] = useState(() => {
    const saved = localStorage.getItem("habit-tracker-data");

    return saved ? JSON.parse(saved) : initialHabits;
  });

  const [view, setView] = useState("habits");
  const [showAdd, setShowAdd] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);

  const activeHabits = habits
    .filter((habit) => !habit.deleted)
    .sort((a, b) => a.order - b.order);

  const deletedHabits = habits.filter((habit) => habit.deleted);

  function save(next) {
    setHabits(next);
    localStorage.setItem("habit-tracker-data", JSON.stringify(next));
  }

  function toggleToday(habit) {
    const next = habits.map((item) => {
      if (item.id !== habit.id) return item;

      const records = { ...item.records };

      if (item.type === "boolean") {
        records[today] = !records[today];
      } else {
        const current = Number(records[today] || 0);

        const amount = prompt(
          `Enter today's amount in ${item.unit}:`,
          current
        );

        if (amount === null) return item;

        records[today] = Number(amount);
      }

      return {
        ...item,
        records
      };
    });

    save(next);
  }

  function moveToBin(id) {
    if (!confirm("Move this habit to the bin? Its data will be preserved.")) {
      return;
    }

    save(
      habits.map((habit) =>
        habit.id === id
          ? {
              ...habit,
              deleted: true,
              deletedAt: new Date().toISOString()
            }
          : habit
      )
    );
  }

  function restore(id) {
    save(
      habits.map((habit) =>
        habit.id === id
          ? {
              ...habit,
              deleted: false,
              deletedAt: null
            }
          : habit
      )
    );
  }

  function permanentlyDelete(id) {
    if (
      !confirm(
        "Permanently delete this habit and ALL of its data? This cannot be undone."
      )
    ) {
      return;
    }

    save(habits.filter((habit) => habit.id !== id));
  }

  function addHabit(data) {
    const newHabit = {
      ...data,
      id: crypto.randomUUID(),
      order: habits.length,
      deleted: false,
      records: {}
    };

    save([...habits, newHabit]);
    setShowAdd(false);
  }

  function updateHabit(data) {
    save(
      habits.map((habit) =>
        habit.id === data.id
          ? {
              ...habit,
              ...data
            }
          : habit
      )
    );

    setEditingHabit(null);
  }

  function moveHabit(index, direction) {
    const sorted = [...activeHabits];

    const target = index + direction;

    if (target < 0 || target >= sorted.length) return;

    [sorted[index], sorted[target]] = [sorted[target], sorted[index]];

    const reordered = sorted.map((habit, i) => ({
      ...habit,
      order: i
    }));

    const result = habits.map((habit) => {
      const replacement = reordered.find((h) => h.id === habit.id);
      return replacement || habit;
    });

    save(result);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Habit Tracker</h1>
          <p>{new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric"
          })}</p>
        </div>

        <button className="add-button" onClick={() => setShowAdd(true)}>
          <Plus size={20} />
          <span>Add Habit</span>
        </button>
      </header>

      <nav className="navigation">
        <button
          className={view === "habits" ? "active" : ""}
          onClick={() => setView("habits")}
        >
          <CalendarDays size={18} />
          Habits
        </button>

        <button
          className={view === "statistics" ? "active" : ""}
          onClick={() => setView("statistics")}
        >
          <BarChart3 size={18} />
          Statistics
        </button>

        <button
          className={view === "bin" ? "active" : ""}
          onClick={() => setView("bin")}
        >
          <Archive size={18} />
          Bin
        </button>
      </nav>

      <main>
        {view === "habits" && (
          <section>
            {activeHabits.length === 0 ? (
              <div className="empty">
                <h2>No habits yet</h2>
                <p>Create your first habit to get started.</p>
                <button onClick={() => setShowAdd(true)}>
                  <Plus size={18} />
                  Add Habit
                </button>
              </div>
            ) : (
              activeHabits.map((habit, index) => (
                <div className="sortable" key={habit.id}>
                  <HabitCard
                    habit={habit}
                    onToggleToday={toggleToday}
                    onDelete={moveToBin}
                    onEdit={setEditingHabit}
                  />

                  <div className="move-controls">
                    <button
                      disabled={index === 0}
                      onClick={() => moveHabit(index, -1)}
                    >
                      ↑
                    </button>

                    <button
                      disabled={index === activeHabits.length - 1}
                      onClick={() => moveHabit(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {view === "statistics" && (
          <section className="panel">
            <h2>Statistics</h2>

            {activeHabits.map((habit) => {
              const values = Object.values(habit.records);

              const total =
                habit.type === "boolean"
                  ? values.filter(Boolean).length
                  : values.reduce((a, b) => a + Number(b || 0), 0);

              return (
                <div className="stat-row" key={habit.id}>
                  <strong>{habit.name}</strong>
                  <span>
                    {habit.type === "boolean"
                      ? `${total} completed days`
                      : `${total} ${habit.unit} total`}
                  </span>
                </div>
              );
            })}
          </section>
        )}

        {view === "bin" && (
          <section className="panel">
            <h2>Bin</h2>

            {deletedHabits.length === 0 ? (
              <div className="empty-small">The bin is empty.</div>
            ) : (
              deletedHabits.map((habit) => (
                <div className="bin-row" key={habit.id}>
                  <div>
                    <strong>{habit.name}</strong>
                    <small>
                      Deleted{" "}
                      {habit.deletedAt
                        ? new Date(habit.deletedAt).toLocaleDateString()
                        : ""}
                    </small>
                  </div>

                  <div>
                    <button onClick={() => restore(habit.id)}>
                      <RotateCcw size={16} />
                      Restore
                    </button>

                    <button
                      className="danger"
                      onClick={() => permanentlyDelete(habit.id)}
                    >
                      <Trash2 size={16} />
                      Delete permanently
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        )}
      </main>

      {(showAdd || editingHabit) && (
        <HabitModal
          habit={editingHabit}
          onClose={() => {
            setShowAdd(false);
            setEditingHabit(null);
          }}
          onSave={editingHabit ? updateHabit : addHabit}
        />
      )}
    </div>
  );
}

function HabitModal({ habit, onClose, onSave }) {
  const [name, setName] = useState(habit?.name || "");
  const [type, setType] = useState(habit?.type || "numeric");
  const [unit, setUnit] = useState(habit?.unit || "hours");
  const [referenceAmount, setReferenceAmount] = useState(
    habit?.referenceAmount || 1
  );

  function submit(e) {
    e.preventDefault();

    if (!name.trim()) return;

    onSave({
      ...(habit || {}),
      name: name.trim(),
      type,
      unit: type === "numeric" ? unit : "",
      referenceAmount:
        type === "numeric" ? Number(referenceAmount) : null
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <h2>{habit ? "Edit Habit" : "Create Habit"}</h2>

        <label>
          Habit name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Study"
            autoFocus
          />
        </label>

        <label>
          Habit type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="numeric">Numeric</option>
            <option value="boolean">Yes / No</option>
          </select>
        </label>

        {type === "numeric" && (
          <>
            <label>
              Unit
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="hours"
              />
            </label>

            <label>
              Reference amount
              <input
                type="number"
                min="0.01"
                step="any"
                value={referenceAmount}
                onChange={(e) => setReferenceAmount(e.target.value)}
              />
            </label>

            {habit && (
              <p className="modal-note">
                Changing the reference will recalculate the intensity of
                all historical days.
              </p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>

          <button className="primary" type="submit">
            {habit ? "Save changes" : "Create habit"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
