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
  deleteField,
  doc,
  getDocs,
  setDoc,
  writeBatch,
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

/* =========================================================
   FIRESTORE RECORD MIGRATION
   ========================================================= */

async function migrateLegacyRecords(
  userId,
  habitId,
  records
) {
  const entries = Object.entries(records || {});

  if (entries.length === 0) {
    return;
  }

  const recordsPath = collection(
    db,
    "users",
    userId,
    "habits",
    habitId,
    "records"
  );

  // Firestore batches have a limit.
  // 400 leaves room below the 500-operation limit.
  const chunkSize = 400;

  for (
    let start = 0;
    start < entries.length;
    start += chunkSize
  ) {
    const chunk = entries.slice(
      start,
      start + chunkSize
    );

    const batch = writeBatch(db);

    for (const [date, value] of chunk) {
      const recordRef = doc(
        recordsPath,
        date
      );

      batch.set(recordRef, {
        value,
      });
    }

    await batch.commit();
  }

  // Remove the old embedded records only
  // after all records were successfully copied.
  await setDoc(
    doc(
      db,
      "users",
      userId,
      "habits",
      habitId
    ),
    {
      records: deleteField(),
    },
    {
      merge: true,
    }
  );
}

async function loadHabitRecords(
  userId,
  habitId
) {
  const recordsSnapshot = await getDocs(
    collection(
      db,
      "users",
      userId,
      "habits",
      habitId,
      "records"
    )
  );

  const records = {};

  recordsSnapshot.forEach((recordDoc) => {
    const data = recordDoc.data();

    records[recordDoc.id] = data.value;
  });

  return records;
}

/* =========================================================
   HABIT HELPERS
   ========================================================= */

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
    const value = habit.records?.[key];

    const successful =
      habit.type === "boolean"
        ? value === true
        : Number(value || 0) >=
          habit.referenceAmount;

    if (!successful) break;

    streak++;

    date.setDate(
      date.getDate() - 1
    );
  }

  return streak;
}

/* =========================================================
   CALENDAR
   ========================================================= */

function Calendar({ habit }) {
  const days = useMemo(() => {
    const result = [];
    const now = new Date();

    for (let i = 89; i >= 0; i--) {
      const date = new Date(now);

      date.setDate(
        now.getDate() - i
      );

      result.push(date);
    }

    return result;
  }, []);

  return (
    <div className="calendar-wrapper">
      <div className="calendar">
        {days.map((date) => {
          const key =
            date.toISOString().slice(0, 10);

          const value =
            habit.records?.[key];

          let level = 0;

          if (habit.type === "boolean") {
            level = value ? 4 : 0;
          } else {
            level = intensity(
              value,
              habit.referenceAmount
            );
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

/* =========================================================
   HABIT CARD
   ========================================================= */

function HabitCard({
  habit,
  onToggleToday,
  onDelete,
  onEdit,
}) {
  const todayValue =
    habit.records?.[today];

  const streak = getStreak(habit);

  return (
    <div className="habit-card">
      <div className="habit-header">
        <div className="habit-title-area">
          <GripVertical
            className="drag-icon"
            size={19}
          />

          <div>
            <h2>{habit.name}</h2>

            {habit.type === "numeric" ? (
              <p>
                Reference:{" "}
                {habit.referenceAmount}{" "}
                {habit.unit}
              </p>
            ) : (
              <p>Yes / No habit</p>
            )}
          </div>
        </div>

        <div className="habit-actions">
          <button
            onClick={() =>
              onEdit(habit)
            }
            title="Edit"
          >
            <Settings size={17} />
          </button>

          <button
            onClick={() =>
              onDelete(habit)
            }
            title="Move to bin"
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      <Calendar habit={habit} />

      <div className="habit-footer">
        <div className="streak">
          <Flame size={17} />

          <strong>
            {streak}
          </strong>

          <span>
            day streak
          </span>
        </div>

        <button
          className="today-button"
          onClick={() =>
            onToggleToday(habit)
          }
        >
          {habit.type === "boolean" ? (
            todayValue ? (
              <>
                <Check size={17} />
                Done
              </>
            ) : (
              <>
                <X size={17} />
                Mark done
              </>
            )
          ) : (
            <>
              Today:{" "}
              {todayValue || 0}{" "}
              {habit.unit}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   LOGIN SCREEN
   ========================================================= */

function LoginScreen({ onLogin }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">
          <CalendarDays size={32} />
        </div>

        <h1>Habit Tracker</h1>

        <p>
          Track your habits, build consistency,
          and see your progress.
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

/* =========================================================
   MAIN APP
   ========================================================= */

function App() {
  const [user, setUser] =
    useState(undefined);

  const [habits, setHabits] =
    useState([]);

  const [loadingHabits, setLoadingHabits] =
    useState(false);

  const [view, setView] =
    useState("habits");

  const [showAdd, setShowAdd] =
    useState(false);

  const [editingHabit, setEditingHabit] =
    useState(null);

  /* -------------------------------------------------------
     AUTH STATE
     ------------------------------------------------------- */

  useEffect(() => {
    const unsubscribe =
      onAuthStateChanged(
        auth,
        (currentUser) => {
          setUser(currentUser);
        }
      );

    return unsubscribe;
  }, []);

  /* -------------------------------------------------------
     LOAD HABITS + MIGRATE OLD RECORDS
     ------------------------------------------------------- */

  useEffect(() => {
    async function loadHabits() {
      if (!user) {
        setHabits([]);
        return;
      }

      try {
        setLoadingHabits(true);

        const habitsRef =
          collection(
            db,
            "users",
            user.uid,
            "habits"
          );

        const snapshot =
          await getDocs(habitsRef);

        /* -------------------------------------------------
           NEW USER
           ------------------------------------------------- */

        if (snapshot.empty) {
          const seededHabits =
            initialHabits.map(
              (habit) => ({
                ...habit,
                records: {},
              })
            );

          for (
            let i = 0;
            i < initialHabits.length;
            i++
          ) {
            const habit =
              initialHabits[i];

            const habitRef =
              doc(
                db,
                "users",
                user.uid,
                "habits",
                habit.id
              );

            const {
              records,
              ...habitData
            } = habit;

            // Store habit metadata.
            await setDoc(
              habitRef,
              habitData
            );

            // Store daily records
            // separately.
            await migrateLegacyRecords(
              user.uid,
              habit.id,
              records
            );

            seededHabits[i] = {
              ...habitData,
              records: {
                ...records,
              },
            };
          }

          setHabits(
            seededHabits
          );

          return;
        }

        /* -------------------------------------------------
           EXISTING USER
           ------------------------------------------------- */

        const loadedHabits = [];

        for (
          const item of snapshot.docs
        ) {
          const data =
            item.data();

          /*
           * If the old records object exists,
           * migrate it to the subcollection.
           */
          if (
            data.records &&
            typeof data.records ===
              "object"
          ) {
            await migrateLegacyRecords(
              user.uid,
              item.id,
              data.records
            );
          }

          /*
           * Always read daily records
           * from the new subcollection.
           */
          const records =
            await loadHabitRecords(
              user.uid,
              item.id
            );

          loadedHabits.push({
            id: item.id,
            ...data,
            records,
          });
        }

        setHabits(
          loadedHabits
        );
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

  /* -------------------------------------------------------
     GOOGLE LOGIN
     ------------------------------------------------------- */

  async function handleGoogleLogin() {
    try {
      await signInWithPopup(
        auth,
        googleProvider
      );
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

  /* -------------------------------------------------------
     LOGOUT
     ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     SAVE HABIT METADATA
     ------------------------------------------------------- */

  async function saveHabit(habit) {
    if (!user) return;

    try {
      const {
        records,
        ...habitData
      } = habit;

      await setDoc(
        doc(
          db,
          "users",
          user.uid,
          "habits",
          habit.id
        ),
        habitData,
        {
          merge: true,
        }
      );

      setHabits((current) => {
        const exists =
          current.some(
            (item) =>
              item.id ===
              habit.id
          );

        if (exists) {
          return current.map(
            (item) =>
              item.id ===
              habit.id
                ? habit
                : item
          );
        }

        return [
          ...current,
          habit,
        ];
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

  /* -------------------------------------------------------
     TOGGLE / SAVE TODAY'S RECORD
     ------------------------------------------------------- */

  async function toggleToday(habit) {
    if (!user) return;

    try {
      let value;

      if (
        habit.type ===
        "boolean"
      ) {
        value =
          !habit.records?.[
            today
          ];
      } else {
        const current =
          Number(
            habit.records?.[
              today
            ] || 0
          );

        const amount =
          prompt(
            `Enter today's amount in ${habit.unit}:`,
            current
          );

        if (
          amount === null
        ) {
          return;
        }

        const numericAmount =
          Number(amount);

        if (
          Number.isNaN(
            numericAmount
          ) ||
          numericAmount < 0
        ) {
          alert(
            "Please enter a valid number."
          );

          return;
        }

        value =
          numericAmount;
      }

      /* -----------------------------------------------
         WRITE INDIVIDUAL RECORD DOCUMENT
         ----------------------------------------------- */

      await setDoc(
        doc(
          db,
          "users",
          user.uid,
          "habits",
          habit.id,
          "records",
          today
        ),
        {
          value,
        }
      );

      /* -----------------------------------------------
         UPDATE UI IMMEDIATELY
         ----------------------------------------------- */

      setHabits(
        (current) =>
          current.map(
            (item) => {
              if (
                item.id !==
                habit.id
              ) {
                return item;
              }

              return {
                ...item,
                records: {
                  ...item.records,
                  [today]:
                    value,
                },
              };
            }
          )
      );
    } catch (error) {
      console.error(
        "Failed to save today's record:",
        error
      );

      alert(
        `Failed to save today's record: ${error.message}`
      );
    }
  }

  /* -------------------------------------------------------
     MOVE TO BIN
     ------------------------------------------------------- */

  async function moveToBin(id) {
    if (
      !confirm(
        "Move this habit to the bin? Its data will be preserved."
      )
    ) {
      return;
    }

    const habit =
      habits.find(
        (item) =>
          item.id === id
      );

    if (!habit) return;

    await saveHabit({
      ...habit,
      deleted: true,
      deletedAt:
        new Date().toISOString(),
    });
  }

  /* -------------------------------------------------------
     RESTORE
     ------------------------------------------------------- */

  async function restore(id) {
    const habit =
      habits.find(
        (item) =>
          item.id === id
      );

    if (!habit) return;

    await saveHabit({
      ...habit,
      deleted: false,
      deletedAt: null,
    });
  }

  /* -------------------------------------------------------
     PERMANENT DELETE
     ------------------------------------------------------- */

  async function permanentlyDelete(
    id
  ) {
    if (
      !confirm(
        "Permanently delete this habit and ALL of its data? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      /*
       * Delete all record documents first.
       */
      const recordsSnapshot =
        await getDocs(
          collection(
            db,
            "users",
            user.uid,
            "habits",
            id,
            "records"
          )
        );

      const batch =
        writeBatch(db);

      recordsSnapshot.forEach(
        (recordDoc) => {
          batch.delete(
            recordDoc.ref
          );
        }
      );

      await batch.commit();

      /*
       * Then delete the habit itself.
       */
      await deleteDoc(
        doc(
          db,
          "users",
          user.uid,
          "habits",
          id
        )
      );

      setHabits(
        (current) =>
          current.filter(
            (habit) =>
              habit.id !== id
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

  /* -------------------------------------------------------
     ADD HABIT
     ------------------------------------------------------- */

  async function addHabit(data) {
    const newHabit = {
      ...data,
      id: crypto.randomUUID(),
      order: habits.length,
      deleted: false,
      records: {},
    };

    await saveHabit(
      newHabit
    );

    setShowAdd(false);
  }

  /* -------------------------------------------------------
     UPDATE HABIT
     ------------------------------------------------------- */

  async function updateHabit(data) {
    const existing =
      habits.find(
        (habit) =>
          habit.id ===
          data.id
      );

    if (!existing) return;

    await saveHabit({
      ...existing,
      ...data,
    });

    setEditingHabit(
      null
    );
  }

  /* -------------------------------------------------------
     MOVE HABIT UP / DOWN
     ------------------------------------------------------- */

  async function moveHabit(
    index,
    direction
  ) {
    const sorted = [
      ...activeHabits,
    ];

    const target =
      index + direction;

    if (
      target < 0 ||
      target >=
        sorted.length
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

    /*
     * Update all affected ordering values.
     */
    for (
      let i = 0;
      i < sorted.length;
      i++
    ) {
      const updated = {
        ...sorted[i],
        order: i,
      };

      await saveHabit(
        updated
      );
    }
  }

  /* -------------------------------------------------------
     LOADING
     ------------------------------------------------------- */

  if (user === undefined) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <p>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------
     NOT LOGGED IN
     ------------------------------------------------------- */

  if (!user) {
    return (
      <LoginScreen
        onLogin={
          handleGoogleLogin
        }
      />
    );
  }

  /* -------------------------------------------------------
     SORT HABITS
     ------------------------------------------------------- */

  const activeHabits =
    habits
      .filter(
        (habit) =>
          !habit.deleted
      )
      .sort(
        (a, b) =>
          a.order - b.order
      );

  const deletedHabits =
    habits.filter(
      (habit) =>
        habit.deleted
    );

  /* -------------------------------------------------------
     MAIN UI
     ------------------------------------------------------- */

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>
            Habit Tracker
          </h1>

          <p>
            {new Date().toLocaleDateString(
              undefined,
              {
                weekday:
                  "long",
                month:
                  "long",
                day: "numeric",
              }
            )}
          </p>

          <small>
            {user.displayName ||
              user.email}
          </small>
        </div>

        <div className="topbar-actions">
          <button
            className="add-button"
            onClick={() =>
              setShowAdd(true)
            }
          >
            <Plus size={20} />

            <span>
              Add Habit
            </span>
          </button>

          <button
            className="logout-button"
            onClick={
              handleLogout
            }
            title="Sign out"
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
            setView(
              "habits"
            )
          }
        >
          <CalendarDays
            size={18}
          />

          Habits
        </button>

        <button
          className={
            view ===
            "statistics"
              ? "active"
              : ""
          }
          onClick={() =>
            setView(
              "statistics"
            )
          }
        >
          <BarChart3
            size={18}
          />

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
            <h2>
              Loading habits...
            </h2>

            <p>
              Syncing your habits
              with the cloud.
            </p>
          </div>
        ) : (
          <>
            {/* -----------------------------------------
                HABITS VIEW
                ----------------------------------------- */}

            {view === "habits" && (
              <section>
                {activeHabits.length ===
                0 ? (
                  <div className="empty">
                    <h2>
                      No habits yet
                    </h2>

                    <p>
                      Create your first
                      habit to get
                      started.
                    </p>

                    <button
                      onClick={() =>
                        setShowAdd(
                          true
                        )
                      }
                    >
                      <Plus
                        size={18}
                      />

                      Add Habit
                    </button>
                  </div>
                ) : (
                  activeHabits.map(
                    (
                      habit,
                      index
                    ) => (
                      <div
                        className="sortable"
                        key={
                          habit.id
                        }
                      >
                        <HabitCard
                          habit={
                            habit
                          }
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
                              index ===
                              0
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

            {/* -----------------------------------------
                STATISTICS
                ----------------------------------------- */}

            {view ===
              "statistics" && (
              <section className="panel">
                <h2>
                  Statistics
                </h2>

                {activeHabits.map(
                  (habit) => {
                    const values =
                      Object.values(
                        habit.records ||
                          {}
                      );

                    const total =
                      habit.type ===
                      "boolean"
                        ? values.filter(
                            Boolean
                          ).length
                        : values.reduce(
                            (
                              a,
                              b
                            ) =>
                              a +
                              Number(
                                b ||
                                  0
                              ),
                            0
                          );

                    return (
                      <div
                        className="stat-row"
                        key={
                          habit.id
                        }
                      >
                        <strong>
                          {
                            habit.name
                          }
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

            {/* -----------------------------------------
                BIN
                ----------------------------------------- */}

            {view ===
              "bin" && (
              <section className="panel">
                <h2>
                  Bin
                </h2>

                {deletedHabits.length ===
                0 ? (
                  <div className="empty-small">
                    The bin is
                    empty.
                  </div>
                ) : (
                  deletedHabits.map(
                    (habit) => (
                      <div
                        className="bin-row"
                        key={
                          habit.id
                        }
                      >
                        <div>
                          <strong>
                            {
                              habit.name
                            }
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
                              size={
                                16
                              }
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
                              size={
                                16
                              }
                            />

                            Delete
                            permanently
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

      {/* ---------------------------------------------
          ADD / EDIT MODAL
          --------------------------------------------- */}

      {(showAdd ||
        editingHabit) && (
        <HabitModal
          habit={
            editingHabit
          }
          onClose={() => {
            setShowAdd(
              false
            );

            setEditingHabit(
              null
            );
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

/* =========================================================
   HABIT MODAL
   ========================================================= */

function HabitModal({
  habit,
  onClose,
  onSave,
}) {
  const [name, setName] =
    useState(
      habit?.name || ""
    );

  const [type, setType] =
    useState(
      habit?.type ||
        "numeric"
    );

  const [unit, setUnit] =
    useState(
      habit?.unit ||
        "hours"
    );

  const [
    referenceAmount,
    setReferenceAmount,
  ] = useState(
    habit?.referenceAmount ||
      1
  );

  function submit(e) {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    onSave({
      ...(habit || {}),
      name: name.trim(),
      type,
      unit:
        type ===
        "numeric"
          ? unit
          : "",
      referenceAmount:
        type ===
        "numeric"
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
        onSubmit={
          submit
        }
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

        {type ===
          "numeric" && (
          <>
            <label>
              Unit

              <input
                value={unit}
                onChange={(
                  e
                ) =>
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
                onChange={(
                  e
                ) =>
                  setReferenceAmount(
                    e.target.value
                  )
                }
              />
            </label>

            {habit && (
              <p className="modal-note">
                Changing
                the
                reference
                will
                recalculate
                the
                intensity
                of all
                historical
                days.
              </p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button
            type="button"
            onClick={
              onClose
            }
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
