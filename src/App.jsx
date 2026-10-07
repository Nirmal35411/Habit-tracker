import { useEffect, useMemo, useState } from "react";
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
  LogOut,
} from "lucide-react";

import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";

import { auth, googleProvider, db } from "./firebase";

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
      [today]: 3,
    },
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
      [today]: true,
    },
  },
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
                Reference: {habit.referenceAmount}{" "}
                {habit.unit}
              </p>
            ) : (
              <p>Yes / No habit</p>
            )}
          </div>
        </div>

        <div className="habit-actions">
          <button onClick={() => onEdit(habit)}>
            <Settings size={17} />
          </button>

          <button onClick={() => onDelete(habit)}>
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

        <button
          className="today-button"
          onClick={() => onToggleToday(habit)}
        >
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

function LoginScreen({ onLogin }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">
          <CalendarDays size={32} />
        </div>

        <h1>Habit Tracker</h1>

        <p>
          Track your habits, build consistency, and see
          your progress.
        </p>

        <button
          className="google-login-button"
          onClick={onLogin}
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(undefined);
  const [habits, setHabits] = useState([]);
  const [loadingHabits, setLoadingHabits] = useState(false);

  const [view, setView] = useState("habits");
  const [showAdd, setShowAdd] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadHabits() {
      if (!user) {
        setHabits([]);
        return;
      }

      try {
        setLoadingHabits(true);

        const habitsRef = collection(
          db,
          "users",
          user.uid,
          "habits"
        );

        const snapshot = await getDocs(habitsRef);

        if (snapshot.empty) {
          const seededHabits = initialHabits.map(
            (habit) => ({
              ...habit,
              records: { ...habit.records },
            })
          );

          for (const habit of seededHabits) {
            await setDoc(
              doc(
                db,
                "users",
                user.uid,
                "habits",
                habit.id
              ),
              habit
            );
          }

          setHabits(seededHabits);
        } else {
          const loaded = snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }));

          setHabits(loaded);
        }
      } catch (error) {
        console.error(
          "Failed to load habits:",
          error
        );

        alert(
          `Failed to load habits: ${error.message}`
        );
      } finally {
        setLoadingHabits(false);
      }
    }

    loadHabits();
  }, [user]);

  async function handleGoogleLogin() {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error(
        "Google login failed:",
        error
      );

      alert(
        `Google login failed: ${error.message}`
      );
    }
  }

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(
        "Logout failed:",
        error
      );

      alert(
        `Logout failed: ${error.message}`
      );
    }
  }

  async function saveHabit(habit) {
    if (!user) return;

    try {
      await setDoc(
        doc(
          db,
          "users",
          user.uid,
          "habits",
          habit.id
        ),
        habit
      );

      setHabits((current) => {
        const exists = current.some(
          (item) => item.id === habit.id
        );

        if (exists) {
          return current.map((item) =>
            item.id === habit.id
              ? habit
              : item
          );
        }

        return [...current, habit];
      });
    } catch (error) {
      console.error(
        "Failed to save habit:",
        error
      );

      alert(
        `Failed to save habit: ${error.message}`
      );
    }
  }

  async function toggleToday(habit) {
    const updated = {
      ...habit,
      records: {
        ...habit.records,
      },
    };

    if (habit.type === "boolean") {
      updated.records[today] =
        !updated.records[today];
    } else {
      const current = Number(
        updated.records[today] || 0
      );

      const amount = prompt(
        `Enter today's amount in ${habit.unit}:`,
        current
      );

      if (amount === null) return;

      const numericAmount = Number(amount);

      if (
        Number.isNaN(numericAmount) ||
        numericAmount < 0
      ) {
        alert("Please enter a valid number.");
        return;
      }

      updated.records[today] = numericAmount;
    }

    await saveHabit(updated);
  }

  async function moveToBin(id) {
    if (
      !confirm(
        "Move this habit to the bin? Its data will be preserved."
      )
    ) {
      return;
    }

    const habit = habits.find(
      (item) => item.id === id
    );

    if (!habit) return;

    await saveHabit({
      ...habit,
      deleted: true,
      deletedAt: new Date().toISOString(),
    });
  }

  async function restore(id) {
    const habit = habits.find(
      (item) => item.id === id
    );

    if (!habit) return;

    await saveHabit({
      ...habit,
      deleted: false,
      deletedAt: null,
    });
  }

  async function permanentlyDelete(id) {
    if (
      !confirm(
        "Permanently delete this habit and ALL of its data? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      await deleteDoc(
        doc(
          db,
          "users",
          user.uid,
          "habits",
          id
        )
      );

      setHabits((current) =>
        current.filter(
          (habit) => habit.id !== id
        )
      );
    } catch (error) {
      console.error(
        "Failed to permanently delete habit:",
        error
      );

      alert(
        `Failed to delete habit: ${error.message}`
      );
    }
  }

  async function addHabit(data) {
    const newHabit = {
      ...data,
      id: crypto.randomUUID(),
      order: habits.length,
      deleted: false,
      records: {},
    };

    await saveHabit(newHabit);
    setShowAdd(false);
  }

  async function updateHabit(data) {
    const existing = habits.find(
      (habit) => habit.id === data.id
    );

    if (!existing) return;

    await saveHabit({
      ...existing,
      ...data,
    });

    setEditingHabit(null);
  }

  async function moveHabit(index, direction) {
    const sorted = [...activeHabits];

    const target = index + direction;

    if (
      target < 0 ||
      target >= sorted.length
    ) {
      return;
    }

    [
      sorted[index],
      sorted[target],
    ] = [
      sorted[target],
      sorted[index],
    ];

    for (let i = 0; i < sorted.length; i++) {
      const updated = {
        ...sorted[i],
        order: i,
      };

      await saveHabit(updated);
    }
  }

  if (user === undefined) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onLogin={handleGoogleLogin}
      />
    );
  }

  const activeHabits = habits
    .filter((habit) => !habit.deleted)
    .sort((a, b) => a.order - b.order);

  const deletedHabits = habits.filter(
    (habit) => habit.deleted
  );

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Habit Tracker</h1>

          <p>
            {new Date().toLocaleDateString(
              undefined,
              {
                weekday: "long",
                month: "long",
                day: "numeric",
              }
            )}
          </p>

          <small>
            {user.displayName || user.email}
          </small>
        </div>

        <div className="topbar-actions">
          <button
            className="add-button"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={20} />
            <span>Add Habit</span>
          </button>

          <button
            className="logout-button"
            onClick={handleLogout}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <nav className="navigation">
        <button
          className={
            view === "habits"
              ? "active"
              : ""
          }
          onClick={() =>
            setView("habits")
          }
        >
          <CalendarDays size={18} />
          Habits
        </button>

        <button
          className={
            view === "statistics"
              ? "active"
              : ""
          }
          onClick={() =>
            setView("statistics")
          }
        >
          <BarChart3 size={18} />
          Statistics
        </button>

        <button
          className={
            view === "bin"
              ? "active"
              : ""
          }
          onClick={() =>
            setView("bin")
          }
        >
          <Archive size={18} />
          Bin
        </button>
      </nav>

      <main>
        {loadingHabits ? (
          <div className="empty">
            <h2>Loading habits...</h2>
            <p>
              Syncing your habits with the cloud.
            </p>
          </div>
        ) : (
          <>
            {view === "habits" && (
              <section>
                {activeHabits.length === 0 ? (
                  <div className="empty">
                    <h2>No habits yet</h2>

                    <p>
                      Create your first habit
                      to get started.
                    </p>

                    <button
                      onClick={() =>
                        setShowAdd(true)
                      }
                    >
                      <Plus size={18} />
                      Add Habit
                    </button>
                  </div>
                ) : (
                  activeHabits.map(
                    (habit, index) => (
                      <div
                        className="sortable"
                        key={habit.id}
                      >
                        <HabitCard
                          habit={habit}
                          onToggleToday={
                            toggleToday
                          }
                          onDelete={
                            moveToBin
                          }
                          onEdit={
                            setEditingHabit
                          }
                        />

                        <div className="move-controls">
                          <button
                            disabled={
                              index === 0
                            }
                            onClick={() =>
                              moveHabit(
                                index,
                                -1
                              )
                            }
                          >
                            ↑
                          </button>

                          <button
                            disabled={
                              index ===
                              activeHabits.length -
                                1
                            }
                            onClick={() =>
                              moveHabit(
                                index,
                                1
                              )
                            }
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    )
                  )
                )}
              </section>
            )}

            {view === "statistics" && (
              <section className="panel">
                <h2>Statistics</h2>

                {activeHabits.map(
                  (habit) => {
                    const values =
                      Object.values(
                        habit.records || {}
                      );

                    const total =
                      habit.type ===
                      "boolean"
                        ? values.filter(
                            Boolean
                          ).length
                        : values.reduce(
                            (a, b) =>
                              a +
                              Number(
                                b || 0
                              ),
                            0
                          );

                    return (
                      <div
                        className="stat-row"
                        key={habit.id}
                      >
                        <strong>
                          {habit.name}
                        </strong>

                        <span>
                          {habit.type ===
                          "boolean"
                            ? `${total} completed days`
                            : `${total} ${habit.unit} total`}
                        </span>
                      </div>
                    );
                  }
                )}
              </section>
            )}

            {view === "bin" && (
              <section className="panel">
                <h2>Bin</h2>

                {deletedHabits.length ===
                0 ? (
                  <div className="empty-small">
                    The bin is empty.
                  </div>
                ) : (
                  deletedHabits.map(
                    (habit) => (
                      <div
                        className="bin-row"
                        key={habit.id}
                      >
                        <div>
                          <strong>
                            {habit.name}
                          </strong>

                          <small>
                            Deleted{" "}
                            {habit.deletedAt
                              ? new Date(
                                  habit.deletedAt
                                ).toLocaleDateString()
                              : ""}
                          </small>
                        </div>

                        <div>
                          <button
                            onClick={() =>
                              restore(
                                habit.id
                              )
                            }
                          >
                            <RotateCcw
                              size={16}
                            />
                            Restore
                          </button>

                          <button
                            className="danger"
                            onClick={() =>
                              permanentlyDelete(
                                habit.id
                              )
                            }
                          >
                            <Trash2
                              size={16}
                            />
                            Delete permanently
                          </button>
                        </div>
                      </div>
                    )
                  )
                )}
              </section>
            )}
          </>
        )}
      </main>

      {(showAdd ||
        editingHabit) && (
        <HabitModal
          habit={editingHabit}
          onClose={() => {
            setShowAdd(false);
            setEditingHabit(null);
          }}
          onSave={
            editingHabit
              ? updateHabit
              : addHabit
          }
        />
      )}
    </div>
  );
}

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
      habit?.referenceAmount || 1
    );

  function submit(e) {
    e.preventDefault();

    if (!name.trim()) return;

    onSave({
      ...(habit || {}),
      name: name.trim(),
      type,
      unit:
        type === "numeric"
          ? unit
          : "",
      referenceAmount:
        type === "numeric"
          ? Number(
              referenceAmount
            )
          : null,
    });
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={submit}
      >
        <h2>
          {habit
            ? "Edit Habit"
            : "Create Habit"}
        </h2>

        <label>
          Habit name

          <input
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
              )
            }
            placeholder="e.g. Study"
            autoFocus
          />
        </label>

        <label>
          Habit type

          <select
            value={type}
            onChange={(e) =>
              setType(
                e.target.value
              )
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
                onChange={(e) =>
                  setUnit(
                    e.target.value
                  )
                }
                placeholder="hours"
              />
            </label>

            <label>
              Reference amount

              <input
                type="number"
                min="0.01"
                step="any"
                value={
                  referenceAmount
                }
                onChange={(e) =>
                  setReferenceAmount(
                    e.target.value
                  )
                }
              />
            </label>

            {habit && (
              <p className="modal-note">
                Changing the
                reference will
                recalculate the
                intensity of all
                historical days.
              </p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="primary"
            type="submit"
          >
            {habit
              ? "Save changes"
              : "Create habit"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
